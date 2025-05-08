# Deployment Guide

This guide provides instructions for deploying the application using Docker.

## Prerequisites

- Docker and Docker Compose installed
- Git (to clone or pull updates)
- Basic understanding of terminal/command line

## Initial Deployment Steps

1. **Clone the repository (if not already done)**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Create a production environment file**
   Create a `.env.production` file in the root directory with the following variables:
   ```
   # Server
   NODE_ENV=production
   PORT=5000
   HOST=0.0.0.0

   # MongoDB
   MONGODB_URI=mongodb://mongodb:27017/kick-viewer-simulator
   MONGO_USERNAME=admin
   MONGO_PASSWORD=your_secure_password_here

   # VPN
   VPN_CONFIGS_PATH=/etc/openvpn/client

   # Puppeteer
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
   PUPPETEER_HEADLESS=true

   # Logging
   LOG_LEVEL=info
   ```

3. **Ensure VPN configs are in place**
   Place your VPN configuration files in the `./vpn` directory.

4. **Build and start the containers**
   ```bash
   docker-compose up -d --build
   ```

5. **Verify deployment**
   ```bash
   # Check container status
   docker-compose ps
   
   # Check logs
   docker-compose logs -f
   ```

## Updating the Application

When you need to update the application after code changes:

1. **Pull the latest changes**
   ```bash
   git pull origin main
   ```

2. **Rebuild and restart the containers**
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

## Maintenance Commands

Here are important commands for maintaining your deployment:

1. **View logs**
   ```bash
   # View all logs
   docker-compose logs -f
   
   # View logs for a specific service
   docker-compose logs -f app
   docker-compose logs -f mongodb
   ```

2. **Stop the application**
   ```bash
   docker-compose down
   ```

3. **Restart the application (without rebuilding)**
   ```bash
   docker-compose restart
   ```

4. **Restart a specific service**
   ```bash
   docker-compose restart app
   docker-compose restart mongodb
   ```

5. **Check container status**
   ```bash
   docker-compose ps
   ```

6. **Access MongoDB shell (if needed)**
   ```bash
   docker exec -it kick-mongodb mongosh -u admin -p your_secure_password_here
   ```

7. **Access application container shell**
   ```bash
   docker exec -it kick-viewer-simulator /bin/bash
   ```

8. **Monitor container resource usage**
   ```bash
   docker stats
   ```

9. **Update specific containers**
   ```bash
   # Update MongoDB only
   docker-compose up -d --no-deps --build mongodb
   
   # Update app only
   docker-compose up -d --no-deps --build app
   ```

10. **Backup MongoDB data**
    ```bash
    # Create backup directory
    mkdir -p mongodb_backups
    
    # Backup MongoDB data
    docker exec -it kick-mongodb mongodump --out /dump --username admin --password your_secure_password_here
    docker cp kick-mongodb:/dump ./mongodb_backups/$(date +%Y%m%d_%H%M%S)
    ```

11. **View Docker disk usage**
    ```bash
    docker system df
    ```

12. **Clean up unused Docker resources**
    ```bash
    docker system prune -a
    ```

## Troubleshooting

1. **If containers fail to start**
   - Check logs: `docker-compose logs`
   - Verify environment variables are set correctly
   - Ensure required ports are not in use by other applications

2. **If MongoDB connection fails**
   - Check MongoDB logs: `docker-compose logs mongodb`
   - Verify MongoDB credentials in `.env.production`
   - Check network connectivity between containers

3. **If VPN connection issues occur**
   - Verify VPN configs are correctly placed in ./vpn directory
   - Check app logs for VPN connection details: `docker-compose logs app`
   - Ensure the container has proper permissions for network operations 