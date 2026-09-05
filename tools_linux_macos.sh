#!/usr/bin/env bash
# ====================================================================
# 高校后勤巡查e速办 v4.0 Tools Launcher for Linux & macOS (Shell 启动脚本)
# 自动定位项目根目录并调用 Tools 总控交互式菜单
# ====================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

exec node "$DIR/Tools/TOOL_MENU.js" "$@"
