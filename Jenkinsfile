pipeline {
    agent any

    environment {
        IMAGE_NAME = 'tachy'
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
                }
                sh """
                    docker build \
                        -t ${IMAGE_NAME}:latest \
                        -t ${IMAGE_NAME}:${VERSION} \
                        .
                """
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-credentials',
                    usernameVariable: 'DH_USER',
                    passwordVariable: 'DH_PASS'
                )]) {
                    sh """
                        trap 'docker logout' EXIT
                        echo "\$DH_PASS" | docker login -u "\$DH_USER" --password-stdin
                        docker tag ${IMAGE_NAME}:latest \$DH_USER/${IMAGE_NAME}:latest
                        docker tag ${IMAGE_NAME}:${VERSION} \$DH_USER/${IMAGE_NAME}:${VERSION}
                        docker push \$DH_USER/${IMAGE_NAME}:latest
                        docker push \$DH_USER/${IMAGE_NAME}:${VERSION}
                    """
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
                DEPLOY_HOST = 'tachy@office-laptop.local'   // <user>@<host>
                DEPLOY_DIR  = '/opt/tachy'
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
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo "Published ${IMAGE_NAME}:${VERSION} and :latest to Docker Hub"
        }
        failure {
            echo "Build #${BUILD_NUMBER} failed"
        }
    }
}
