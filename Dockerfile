FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package.json and install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source files and build
COPY frontend/ ./
RUN npm run build

# Backend and final image
FROM node:18-alpine

# Install OpenVPN and required tools
RUN apk add --no-cache \
    chromium \
    chromium-chromedriver \
    openvpn \
    ca-certificates \
    iptables \
    bash \
    sudo \
    && mkdir -p /etc/openvpn/client

# Add a non-root user and give it sudo privilege for OpenVPN
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup && \
    echo "appuser ALL=(ALL) NOPASSWD: /usr/sbin/openvpn, /sbin/ip, /sbin/iptables" > /etc/sudoers.d/appuser

# Create app directory
WORKDIR /app

# Copy backend package.json and install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy backend source files
COPY backend/ ./

# Copy built frontend from the frontend-builder stage
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Create directories for screenshots and logs
RUN mkdir -p screenshots logs && \
    chown -R appuser:appgroup /app

# Set environment variables
ENV NODE_ENV=production \
    PORT=5000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    VPN_CONFIGS_PATH=/etc/openvpn/client

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "server.js"]