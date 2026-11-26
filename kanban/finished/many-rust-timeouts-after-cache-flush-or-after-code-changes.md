---
created: 2026-11-07
---
# many rust timeouts after cache flush or after code changes

Timeout on a high percentage of rust tests when starting cold (cache flushed) is something that has crept in recently. Possibly with

  554ee3b54e9da0985434deb8f13f7c4339cabe0e
