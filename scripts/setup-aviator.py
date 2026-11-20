"""Prepare the pinned AviatorScript interpreter in data/, using an installed JDK (17+)."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request

root = Path(__file__).resolve().parents[1]
out = root / "data/aviator"
out.mkdir(parents=True, exist_ok=True)
artifacts = {
    "com/googlecode/aviator/aviator/5.4.4/aviator-5.4.4.jar": "5432380636ad8b90038a5ec47f06beb3f32fcc95759cb68f0cfaba8253cb4798",
    "com/google/code/gson/gson/2.13.2/gson-2.13.2.jar": "dd0ce1b55a3ed2080cb70f9c655850cda86c206862310009dcb5e5c95265a5e0",
}
jars = []
for path, digest in artifacts.items():
    dest = out / Path(path).name
    data = dest.read_bytes() if dest.exists() else b""
    if hashlib.sha256(data).hexdigest() != digest:
        with urllib.request.urlopen("https://repo.maven.apache.org/maven2/" + path, timeout=30) as res:
            data = res.read()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("JAR 校验失败 " + dest.name)
        dest.write_bytes(data)
    jars.append(str(dest))
jdk = os.getenv("JAVA_HOME")
javac = str(Path(jdk) / "bin/javac") if jdk else next((str(p) for p in out.glob("*/Contents/Home/bin/javac")), shutil.which("javac"))
if not javac:
    raise SystemExit("需要 JDK 17 或以上版本，请设置 JAVA_HOME")
subprocess.run([javac, "--release", "17", "-cp", os.pathsep.join(jars), "-d", str(out), str(root / "server/aviator/LocalAviator.java")], check=True)
(out / "java-path").write_text(str(Path(javac).resolve().with_name("java")))
print("本地 AviatorScript 已就绪")
