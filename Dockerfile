# Stage 1: Build stage (compile TypeScript)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy all files first
COPY . .

# Install dependencies
RUN npm install

# Compile TypeScript
RUN npm run build

# Stage 2: Production stage (run the compiled JavaScript)
FROM node:20-alpine

WORKDIR /app

# Copy package files and install only production dependencies
COPY package.json package-lock.json ./
RUN npm install --production --ignore-scripts

# Copy compiled code from builder stage
COPY --from=builder /app/build ./build

# Expose port and run the application
EXPOSE ${PORT:-8989}
CMD ["node", "build/index.js"]
