FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package.json and package-lock.json for better layer caching
COPY frontend/package*.json ./
RUN npm ci --production=false

# Copy frontend source files and build
COPY frontend/ ./
RUN npm run build

# Backend and final image
FROM node:18-alpine

# Set environment variables
ENV NODE_ENV=production \
    PORT=5000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    VPN_CONFIGS_PATH=/etc/openvpn/client

# Install OpenVPN and required tools without specifying exact versions
RUN apk add --no-cache \
    chromium \
    chromium-chromedriver \
    openvpn \
    ca-certificates \
    iptables \
    bash \
    sudo \
    wget \
    curl \
    && mkdir -p /etc/openvpn/client

# Add a non-root user and give it sudo privilege for OpenVPN without password
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup && \
    echo "appuser ALL=(ALL) NOPASSWD: /usr/sbin/openvpn" > /etc/sudoers.d/appuser && \
    chmod 0440 /etc/sudoers.d/appuser

# Create app directory with proper structure
WORKDIR /app
RUN mkdir -p backend/temp backend/logs screenshots logs data

# Copy package.json and install dependencies with production flag
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# Copy backend source files
COPY backend/ ./backend/

# Copy built frontend from the frontend-builder stage
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Set proper permissions
RUN chown -R appuser:appgroup /app /etc/openvpn && \
    chmod -R 755 /app /etc/openvpn && \
    chmod -R 777 /app/backend/logs /app/screenshots /app/logs /app/data

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --spider -q http://localhost:$PORT/api/health || exit 1

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "backend/server.js"]