#!/bin/bash

# ==========================================
# PeerLink Cloud Deployment Script
# Für Millionen User skalierbar
# ==========================================

set -e

# Farbcodes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Konfiguration
PROJECT_NAME="peerlink"
DOCKER_REGISTRY="your-registry.com"
REGION="us-east-1"

# ==========================================
# Hilfsfunktionen
# ==========================================

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}❌ Fehler: $1${NC}" >&2
    exit 1
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# ==========================================
# System-Checks
# ==========================================

check_requirements() {
    log "Prüfe System-Anforderungen..."

    # Docker
    if ! command -v docker &> /dev/null; then
        error "Docker ist nicht installiert"
    fi

    # Docker Compose
    if ! docker compose version &> /dev/null; then
        error "Docker Compose ist nicht verfügbar"
    fi

    # Cloud CLI Tools
    case "$DEPLOY_TARGET" in
        aws)
            if ! command -v aws &> /dev/null; then
                error "AWS CLI ist nicht installiert"
            fi
            ;;
        gcp)
            if ! command -v gcloud &> /dev/null; then
                error "Google Cloud SDK ist nicht installiert"
            fi
            ;;
        azure)
            if ! command -v az &> /dev/null; then
                error "Azure CLI ist nicht installiert"
            fi
            ;;
    esac

    success "System-Anforderungen erfüllt"
}

# ==========================================
# Docker Image Build & Push
# ==========================================

build_and_push() {
    log "Baue und pushe Docker Images..."

    # Services die gebaut werden müssen
    local services=("signaling-server-1" "signaling-server-2" "monitoring")

    for service in "${services[@]}"; do
        log "Baue $service..."

        # Build Context erstellen
        if [ "$service" = "monitoring" ]; then
            mkdir -p build/monitoring
            cp monitoring.html build/monitoring/
            cp -r monitoring/* build/monitoring/ 2>/dev/null || true
            cd build/monitoring

            # Dockerfile für Monitoring erstellen
            cat > Dockerfile << EOF
FROM nginx:alpine
COPY . /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost || exit 1
EOF

            docker build -t $DOCKER_REGISTRY/$PROJECT_NAME/$service:latest .
            cd ../../
        else
            docker compose build $service
            docker tag $PROJECT_NAME"_"$service $DOCKER_REGISTRY/$PROJECT_NAME/$service:latest
        fi

        # Push to Registry
        log "Pushe $service..."
        docker push $DOCKER_REGISTRY/$PROJECT_NAME/$service:latest
    done

    success "Docker Images erfolgreich gebaut und gepusht"
}

# ==========================================
# AWS Deployment
# ==========================================

deploy_aws() {
    log "Starte AWS Deployment..."

    # ECS Cluster erstellen
    aws ecs create-cluster --cluster-name $PROJECT_NAME-cluster \
        --region $REGION || true

    # ECR Repository erstellen
    for service in signaling-server-1 signaling-server-2 monitoring; do
        aws ecr create-repository --repository-name $PROJECT_NAME/$service \
            --region $REGION || true
    done

    # RDS für MongoDB
    log "Erstelle RDS MongoDB Instance..."
    aws rds create-db-instance \
        --db-instance-identifier $PROJECT_NAME-mongodb \
        --db-instance-class db.t3.medium \
        --engine mongodb \
        --master-username peerlink \
        --master-user-password $(openssl rand -base64 32) \
        --allocated-storage 100 \
        --region $REGION || true

    # ElastiCache für Redis
    log "Erstelle ElastiCache Redis Cluster..."
    aws elasticache create-cache-cluster \
        --cache-cluster-id $PROJECT_NAME-redis \
        --cache-node-type cache.t3.micro \
        --num-cache-nodes 2 \
        --engine redis \
        --region $REGION || true

    # ECS Services deployen
    log "Deploye ECS Services..."

    # Task Definition erstellen
    cat > task-definition.json << EOF
{
    "family": "$PROJECT_NAME-signaling",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "512",
    "memory": "1024",
    "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ecsTaskExecutionRole",
    "containerDefinitions": [
        {
            "name": "signaling-server",
            "image": "$DOCKER_REGISTRY/$PROJECT_NAME/signaling-server-1:latest",
            "essential": true,
            "portMappings": [
                {
                    "containerPort": 8080,
                    "protocol": "tcp"
                }
            ],
            "environment": [
                {"name": "NODE_ENV", "value": "production"},
                {"name": "REDIS_URL", "value": "redis://$PROJECT_NAME-redis.0001.$REGION.cache.amazonaws.com:6379"},
                {"name": "MONGO_URL", "value": "mongodb://peerlink:$(aws rds describe-db-instances --db-instance-identifier $PROJECT_NAME-mongodb --query 'DBInstances[0].MasterUserPassword' --output text)@$PROJECT_NAME-mongodb.cluster-xxxxx.$REGION.rds.amazonaws.com:27017/peerlink"}
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/ecs/$PROJECT_NAME",
                    "awslogs-region": "$REGION",
                    "awslogs-stream-prefix": "ecs"
                }
            }
        }
    ]
}
EOF

    aws ecs register-task-definition --cli-input-json file://task-definition.json

    # Service erstellen
    aws ecs create-service \
        --cluster $PROJECT_NAME-cluster \
        --service-name $PROJECT_NAME-signaling \
        --task-definition $PROJECT_NAME-signaling \
        --desired-count 2 \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx,subnet-yyyyy],securityGroups=[sg-xxxxx]}" \
        --region $REGION

    success "AWS Deployment abgeschlossen"
}

# ==========================================
# Google Cloud Deployment
# ==========================================

deploy_gcp() {
    log "Starte Google Cloud Deployment..."

    # Projekt setzen
    gcloud config set project $PROJECT_NAME

    # Container Registry aktivieren
    gcloud services enable containerregistry.googleapis.com
    gcloud services enable run.googleapis.com
    gcloud services enable firestore.googleapis.com

    # GCR Images pushen
    for service in signaling-server-1 signaling-server-2 monitoring; do
        docker tag $DOCKER_REGISTRY/$PROJECT_NAME/$service:latest gcr.io/$PROJECT_NAME/$service:latest
        gcloud docker -- push gcr.io/$PROJECT_NAME/$service:latest
    done

    # Cloud Run Services deployen
    for service in signaling-server-1 signaling-server-2; do
        gcloud run deploy $service \
            --image gcr.io/$PROJECT_NAME/$service:latest \
            --platform managed \
            --region $REGION \
            --allow-unauthenticated \
            --port 8080 \
            --memory 1Gi \
            --cpu 1 \
            --max-instances 100 \
            --concurrency 100 \
            --timeout 300 \
            --set-env-vars NODE_ENV=production,REDIS_URL=redis://redis-host:6379,MONGO_URL=mongodb://mongo-host:27017/peerlink
    done

    # Monitoring als statische Website
    gsutil mb -p $PROJECT_NAME gs://$PROJECT_NAME-monitoring
    gsutil cp monitoring.html gs://$PROJECT_NAME-monitoring/
    gsutil web set -m index.html gs://$PROJECT_NAME-monitoring

    success "Google Cloud Deployment abgeschlossen"
}

# ==========================================
# Azure Deployment
# ==========================================

deploy_azure() {
    log "Starte Azure Deployment..."

    # Resource Group erstellen
    az group create --name $PROJECT_NAME-rg --location $REGION

    # Container Registry
    az acr create --resource-group $PROJECT_NAME-rg \
        --name $PROJECT_NAME"acr" --sku Basic

    # Images pushen
    for service in signaling-server-1 signaling-server-2 monitoring; do
        az acr build --registry $PROJECT_NAME"acr" \
            --image $service:latest \
            --file Dockerfile .
    done

    # Azure Database for MongoDB
    az cosmosdb create --name $PROJECT_NAME-mongodb \
        --resource-group $PROJECT_NAME-rg \
        --kind MongoDB \
        --server-version 4.0 \
        --locations regionName=$REGION failoverPriority=0

    # Azure Cache for Redis
    az redis create --name $PROJECT_NAME-redis \
        --resource-group $PROJECT_NAME-rg \
        --location $REGION \
        --sku Basic --vm-size C1

    # Container Instances für Signaling Server
    for i in 1 2; do
        az container create \
            --resource-group $PROJECT_NAME-rg \
            --name $PROJECT_NAME-signaling-$i \
            --image $PROJECT_NAME"acr.azurecr.io/signaling-server-$i:latest" \
            --cpu 1 --memory 1 \
            --registry-login-server $PROJECT_NAME"acr.azurecr.io" \
            --registry-username $(az acr credential show -n $PROJECT_NAME"acr" --query username -o tsv) \
            --registry-password $(az acr credential show -n $PROJECT_NAME"acr" --query passwords[0].value -o tsv) \
            --ports 8080 \
            --environment-variables NODE_ENV=production REDIS_URL=redis://$PROJECT_NAME-redis.redis.cache.windows.net:6379 MONGO_URL=mongodb://$PROJECT_NAME-mongodb.mongo.cosmos.azure.com:10255/peerlink
    done

    success "Azure Deployment abgeschlossen"
}

# ==========================================
# Kubernetes Deployment
# ==========================================

deploy_kubernetes() {
    log "Starte Kubernetes Deployment..."

    # Namespace erstellen
    kubectl create namespace $PROJECT_NAME --dry-run=client -o yaml | kubectl apply -f -

    # ConfigMaps und Secrets
    kubectl create secret generic $PROJECT_NAME-secrets \
        --from-literal=jwt-secret=$(openssl rand -hex 32) \
        --from-literal=mongo-password=$(openssl rand -base64 32) \
        --namespace $PROJECT_NAME --dry-run=client -o yaml | kubectl apply -f -

    # MongoDB StatefulSet
    cat > mongodb.yaml << EOF
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: $PROJECT_NAME
spec:
  replicas: 3
  serviceName: mongodb
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
      - name: mongodb
        image: mongo:6-jammy
        ports:
        - containerPort: 27017
        env:
        - name: MONGO_INITDB_ROOT_USERNAME
          value: "peerlink"
        - name: MONGO_INITDB_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: $PROJECT_NAME-secrets
              key: mongo-password
        volumeMounts:
        - name: mongodb-data
          mountPath: /data/db
  volumeClaimTemplates:
  - metadata:
      name: mongodb-data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 100Gi
EOF

    kubectl apply -f mongodb.yaml

    # Redis Deployment
    cat > redis.yaml << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: $PROJECT_NAME
spec:
  replicas: 2
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        volumeMounts:
        - name: redis-data
          mountPath: /data
      volumes:
      - name: redis-data
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: $PROJECT_NAME
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
EOF

    kubectl apply -f redis.yaml

    # Signaling Server Deployment
    cat > signaling-deployment.yaml << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: signaling-server
  namespace: $PROJECT_NAME
spec:
  replicas: 3
  selector:
    matchLabels:
      app: signaling-server
  template:
    metadata:
      labels:
        app: signaling-server
    spec:
      containers:
      - name: signaling-server
        image: $DOCKER_REGISTRY/$PROJECT_NAME/signaling-server-1:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_URL
          value: "redis://redis:6379"
        - name: MONGO_URL
          value: "mongodb://peerlink:$(kubectl get secret $PROJECT_NAME-secrets -n $PROJECT_NAME -o jsonpath='{.data.mongo-password}' | base64 -d)@mongodb:27017/peerlink"
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: signaling-server
  namespace: $PROJECT_NAME
spec:
  selector:
    app: signaling-server
  ports:
  - port: 8080
    targetPort: 8080
  type: LoadBalancer
EOF

    kubectl apply -f signaling-deployment.yaml

    success "Kubernetes Deployment abgeschlossen"
}

# ==========================================
# Hauptprogramm
# ==========================================

usage() {
    echo "PeerLink Cloud Deployment Script"
    echo ""
    echo "Verwendung:"
    echo "  $0 [aws|gcp|azure|kubernetes] [build|deploy|all]"
    echo ""
    echo "Beispiele:"
    echo "  $0 aws all           - Vollständiges AWS Deployment"
    echo "  $0 gcp build         - Nur Images bauen für GCP"
    echo "  $0 kubernetes deploy - Kubernetes Deployment"
    echo ""
    echo "Voraussetzungen:"
    echo "  - Docker und Docker Compose"
    echo "  - Cloud CLI Tools (aws, gcloud, az)"
    echo "  - env-example.txt konfiguriert"
}

# Parameter parsen
DEPLOY_TARGET=${1:-aws}
ACTION=${2:-all}

case "$DEPLOY_TARGET" in
    aws|gcp|azure|kubernetes)
        ;;
    *)
        error "Ungültiges Deployment-Ziel: $DEPLOY_TARGET"
        usage
        exit 1
        ;;
esac

case "$ACTION" in
    build|deploy|all)
        ;;
    *)
        error "Ungültige Aktion: $ACTION"
        usage
        exit 1
        ;;
esac

# Hauptlogik
log "PeerLink Enterprise Cloud Deployment"
log "Ziel: $DEPLOY_TARGET, Aktion: $ACTION"

check_requirements

case "$ACTION" in
    build|all)
        build_and_push
        ;;
esac

case "$ACTION" in
    deploy|all)
    case "$DEPLOY_TARGET" in
        aws)
            deploy_aws
            ;;
        gcp)
            deploy_gcp
            ;;
        azure)
            deploy_azure
            ;;
        kubernetes)
            deploy_kubernetes
            ;;
    esac
    ;;
esac

success "Deployment erfolgreich abgeschlossen!"
log "PeerLink ist nun für Millionen User bereit! 🚀"

