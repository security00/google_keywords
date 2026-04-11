#!/bin/bash
cd /root/projects/google_keywords
export GK_API_KEY="gk_live_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
export GK_SITE_URL="https://discoverkeywords.co"
python3 scripts/precompute.py "$@"
