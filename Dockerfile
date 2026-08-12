FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json (if any)
COPY package.json ./

# Install app dependencies
RUN npm install --production

# Copy source code
COPY . ./

# Expose port (default 3000)
EXPOSE 3000

# Set environment variables placeholder (should be overridden at runtime)
ENV PORT=3000

# Start the server
CMD ["node", "server.js"]
