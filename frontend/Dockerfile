# Frontend Dockerfile - Multi-stage build for React app
# Stage 1: Build the React application
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --silent

# Copy source code
COPY . .

# Set production mode for build
ENV NODE_ENV=production

# REACT_APP_REGISTRY_API_URL is inlined by DefinePlugin, so it has to be present
# before `npm run build` runs. Default to same-origin (""): in the shipped
# docker-compose topology the outer nginx serves the frontend and proxies the
# API on the same origin, so baking in a placeholder public URL would make a
# self-hosted build talk to the production registry. Pass
# --build-arg REACT_APP_REGISTRY_API_URL=https://api.example.org for split-host
# deployments.
ARG REACT_APP_REGISTRY_API_URL=""
ENV REACT_APP_REGISTRY_API_URL=${REACT_APP_REGISTRY_API_URL}

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
