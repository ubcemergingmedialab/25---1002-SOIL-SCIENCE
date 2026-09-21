pipeline {
    agent 'linux'
    tools {
        nodejs '24'
    }

    stages {
        stage("Checkout"){
            steps {
                checkout scm
            }
        }
        stage("Install dependencies"){
            steps {
                sh 'npm ci'
            }
        }
        stage("Build"){
            steps {
                sh 'npm run build'
            }
        }
        stage("Archive"){
            steps {
                // Fingerprinting allows us to find where a build came from (ie archive files -> version)
                archiveArtifacts artifacts: 'apps/admin/dist/**/*', fingerprint: true
                archiveArtifacts artifacts: 'apps/viewer/dist/**/*', fingerprint: true
            }
        }
        /*
        TODO Follow up with team to figure out what credentials are needed for this operation.
        stage("Deploy"){
            when {
                buildingTag()
            }
            steps {
                sh 'chmod +x deploy_viewer.sh'
                sh 'chmod +x deploy_admin.sh'
                sh './deploy_viewer.sh'
                sh './deploy_admin.sh'
            }
        }*/
    }
}