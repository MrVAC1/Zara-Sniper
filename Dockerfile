# Base image with official Playwright 1.58.1 & Node.js 20+
FROM mcr.microsoft.com/playwright:v1.58.1-jammy

# Set working directory to /app
WORKDIR /app

# Switch to root to change ownership and install dependencies
USER root

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including production deps)
RUN npm install

# Install Chromium (specific to Playwright 1.58.1 strict matching)
RUN npx playwright install chromium

# Copy the rest of the application
COPY . .

# Create browser profile directory ensuring correct ownership
RUN mkdir -p /app/zara_user_profile_360527303 && \
    chown -R 1000:1000 /app

# Set ENV for Docker detection in app
ENV IS_DOCKER=true
ENV PORT=7860
# Force IPv4 DNS resolution
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
# Force IPv4 DNS resolution
ENV NODE_OPTIONS="--dns-result-order=ipv4first"


# Expose the port for HF Spaces
EXPOSE 7860

# Switch to non-root user (UID 1000) as required by Hugging Face
USER 1000

# Start command
CMD ["npm", "start"]
