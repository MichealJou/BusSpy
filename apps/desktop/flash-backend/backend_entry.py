"""PyInstaller 打包入口：以绝对导入方式启动 flash_backend RPC 服务。"""

from flash_backend.__main__ import serve

if __name__ == "__main__":
    serve()
