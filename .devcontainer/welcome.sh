#!/bin/bash
# Welcome message displayed after devcontainer creation

cat << 'EOF'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Welcome to Semiont Workflows Demo!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your devcontainer is ready. To complete setup:

    bash .devcontainer/setup-demo.sh

This will:
  • Wait for backend and frontend services to start
  • Run database migrations
  • Create a demo admin account with random credentials
  • Save credentials to .env file

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
