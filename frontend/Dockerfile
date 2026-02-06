# Frontend Dockerfile - Multi-stage build for React app
# Stage 1: Build the React application
FROM node:24-alpine AS builder

# Enable Node.js debug mode for better error messages
ENV NODE_ENV=development
ENV NPM_CONFIG_LOGLEVEL=verbose

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --silent

# Copy source code
COPY . .

# Set production mode for build
ENV NODE_ENV=production

# Build the production bundle
RUN npm run build

# Stage 2: Production image with nginx
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
