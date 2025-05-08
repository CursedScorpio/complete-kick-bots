# Kick Viewer Simulator

A full-stack application designed to simulate viewer engagement for Kick.com streams.

## Features

- VPN integration for global IP distribution
- Puppeteer-based browser automation
- MongoDB database for data storage
- React frontend for monitoring and control
- Docker-ready deployment

## Quick Start

### Development Environment

1. **Start Backend:**
   ```bash
   npm run dev
   ```

2. **Start Frontend:**
   ```bash
   cd frontend
   npm start
   ```

### Production Deployment

For full production deployment using Docker:

1. Set up environment variables (see `.env.production` guide in DEPLOYMENT.md)
2. Run Docker Compose:
   ```bash
   docker-compose up -d
   ```

For complete deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Project Structure

- `/frontend` - React frontend application
- `/backend` - Node.js Express backend API
- `/vpn` - VPN configuration files
- `/data` - Persistent data storage
- `/screenshots` - Browser screenshots storage
- `/logs` - Application logs

## Technology Stack

- **Frontend:** React, Tailwind CSS
- **Backend:** Node.js, Express
- **Database:** MongoDB
- **Automation:** Puppeteer
- **Containerization:** Docker, Docker Compose
- **Networking:** OpenVPN

## License

Private - All rights reserved
