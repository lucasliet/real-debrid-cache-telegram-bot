#!/bin/sh

# Create git hooks directory if it doesn't exist
mkdir -p .git/hooks

# Create symbolic links for all hooks
for hook in $(ls -1 .hooks/* | grep -v "install.sh"); do
    ln -sf "../../${hook}" ".git/hooks/$(basename ${hook})"
done

# Make all hooks executable
chmod +x .hooks/*
