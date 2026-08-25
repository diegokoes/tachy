pipeline {
    agent any

    environment {
        IMAGE_NAME  = 'tachy'
        DEPLOY_HOST = 'tachy@office-laptop.local'   // <user>@<host>
    }

    options {
        timeout(time: 15, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install & test') {
            steps {
                sh '''
                    npm ci
                    npm run typecheck
                    npm run web:check
                    npm test
                '''
            }
        }

        stage('Build Docker image') {
            steps {
                script {
                    env.VERSION = sh(
                        script: "node -p \"require('./package.json').version\"",
                        returnStdout: true
                    ).trim()

                    // main publishes :latest and :<version>; dev publishes :dev.
                    // Separate tags are what keep the two stacks from ever
                    // pulling each other's image.
                    env.TAGS = env.BRANCH_NAME == 'dev'
                        ? "dev"
                        : "latest ${env.VERSION}"

                    def args = env.TAGS.split(' ').collect {
                        "-t ${env.IMAGE_NAME}:${it}"
                    }.join(' ')
                    sh "docker build ${args} ."
                }
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-credentials',
                    usernameVariable: 'DH_USER',
                    passwordVariable: 'DH_PASS'
                )]) {
                    script {
                        sh '''
                            trap 'docker logout' EXIT
                            echo "$DH_PASS" | docker login -u "$DH_USER" --password-stdin
                        '''
                        for (tag in env.TAGS.split(' ')) {
                            sh """
                                docker tag ${IMAGE_NAME}:${tag} \$DH_USER/${IMAGE_NAME}:${tag}
                                docker push \$DH_USER/${IMAGE_NAME}:${tag}
                            """
                        }
                    }
                }
            }
        }

        // Pull-and-restart on the office server. Restarting drops in-flight
        // agent turns (SSE streams); with TACHY_SESSION_SECRET set, logins
        // survive, and past chats resume via the persisted agent-home volume.
        // Needs: 'tachy-deploy-ssh' SSH credentials in Jenkins, and the
        // compose checkout living at DEPLOY_DIR on the server.
        stage('Deploy') {
            when { branch 'main' }
            environment {
                DEPLOY_DIR = '/opt/tachy'
            }
            steps {
                sshagent(credentials: ['tachy-deploy-ssh']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST" "
                            cd $DEPLOY_DIR &&
                            docker compose pull api &&
                            docker compose up -d api &&
                            docker image prune -f
                        "
                    '''
                }
            }
        }

        // The dev stack: a second checkout, on the dev branch, running as its
        // own compose project (COMPOSE_PROJECT_NAME in its .env). It resets to
        // origin/dev because docker-compose.yml is itself versioned, so the
        // checkout has to match the image being pulled.
        stage('Deploy dev') {
            when { branch 'dev' }
            environment {
                DEPLOY_DIR = '/opt/tachy-dev'
            }
            steps {
                sshagent(credentials: ['tachy-deploy-ssh']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST" "
                            cd $DEPLOY_DIR &&
                            git fetch origin dev &&
                            git reset --hard origin/dev &&
                            docker compose pull api &&
                            docker compose up -d api &&
                            docker image prune -f
                        "
                    '''
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo "Published ${IMAGE_NAME} tags: ${env.TAGS}"
        }
        failure {
            echo "Build #${BUILD_NUMBER} failed"
        }
    }
}
