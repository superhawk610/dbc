#!/bin/bash

# do some processing (make sure to redirect output to stderr,
# since anything printed to stdout is part of the password)
echo "One..." >&2
sleep 1
echo "Two..." >&2
sleep 1
echo "Three..." >&2
sleep 1

# print password
echo "postgres"