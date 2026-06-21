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
