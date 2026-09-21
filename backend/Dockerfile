# Use the official Golang image to create a build artifact.
FROM golang:1.24 AS builder

# Create and change to the app directory.
WORKDIR /app

# Retrieve application dependencies.
# This allows the container build to reuse cached dependencies.
# Expecting to copy go.mod and if present go.sum.
COPY go.mod go.sum ./
RUN go mod download

# Copy local code to the container image.
COPY . .

# Build the binary.
# -o server: output binary name
# -v: verbose
# CGO_ENABLED=0: static binary for distroless
RUN CGO_ENABLED=0 GOOS=linux go build -v -o server .

# Use the official Google Distroless image for a lean production image.
# https://github.com/GoogleContainerTools/distroless
FROM gcr.io/distroless/static:nonroot

WORKDIR /

# Copy the binary to the production image from the builder stage.
COPY --from=builder /app/server /server

# Service must listen to $PORT environment variable.
# This default value facilitates local development.
ENV PORT=8080

# Run the web service on container startup.
USER nonroot:nonroot
ENTRYPOINT ["/server"]
