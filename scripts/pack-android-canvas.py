"""Assemble the Android-only NativeScript Canvas package from the verified npm input and patched JNI AAR."""
import argparse, base64, gzip, hashlib, io, json, pathlib, shutil, tarfile, tempfile, urllib.request, zipfile
p=argparse.ArgumentParser();p.add_argument('patched_aar',type=pathlib.Path);p.add_argument('manifest',type=pathlib.Path);p.add_argument('out',type=pathlib.Path);args=p.parse_args()
manifest=json.loads(args.manifest.read_text())
root=pathlib.Path(__file__).resolve().parents[1]
patches=root/'hosts/android-tv/patches'
assert manifest['sourceCommit']=='04f0e69ce3129b46f37875758718d6f30ece1636'
for key,file in [('patchSha256','canvas-android-respect-antialias.patch'),('cargoLockSha256','canvas-Cargo.lock')]:
    assert hashlib.sha256((patches/file).read_bytes()).hexdigest()==manifest[key]
abis=('armeabi-v7a','arm64-v8a','x86_64')
assert set(manifest['abis'])==set(abis)
url='https://registry.npmjs.org/@nativescript/canvas/-/canvas-3.0.0-beta.6.tgz'
integrity='6BiIh8yQKKIMa1pNz7aeIseztAieBETPSivTcFwRdJQW5g7ZXmt0lwdNk7nN8zYuM1tGq6TcSZ+ZxFiHehhU0g=='
with tempfile.TemporaryDirectory() as work:
    tmp=pathlib.Path(work); original=tmp/'original.tgz'
    with urllib.request.urlopen(url) as src,original.open('wb') as dst:shutil.copyfileobj(src,dst)
    with original.open('rb') as src:assert base64.b64encode(hashlib.file_digest(src,'sha512').digest()).decode()==integrity
    with tarfile.open(original) as archive:
        members=[m for m in archive if (not m.name.startswith('package/platforms/') or m.name.startswith('package/platforms/android/'))]
        archive.extractall(tmp,members=members,filter='data')
    package=tmp/'package'; aar=package/'platforms/android/canvas-release.aar'
    with zipfile.ZipFile(aar) as stock,zipfile.ZipFile(args.patched_aar) as replacement:
        assert set(stock.namelist())==set(replacement.namelist())
        for filename in stock.namelist():
            parts=filename.split('/')
            if len(parts)==3 and parts[0]=='jni' and parts[2]=='libcanvasnative.so' and parts[1] in manifest['abis']:
                assert hashlib.sha256(replacement.read(filename)).hexdigest()==manifest['abis'][parts[1]]
            else:assert stock.read(filename)==replacement.read(filename)
    shutil.copyfile(args.patched_aar,aar)
    provenance={'source':url,'upstreamIntegrity':'sha512-'+integrity,**manifest}
    (package/'SOLID-MULTIPLATFORM.json').write_text(json.dumps(provenance,indent=2)+'\n')
    shutil.copyfile(patches/'canvas-android-respect-antialias.patch',package/'canvas-android-respect-antialias.patch')
    out=args.out;out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('wb') as output,gzip.GzipFile(fileobj=output,filename='',mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as tar:
        for file in sorted(package.rglob('*')):
            if not file.is_file():continue
            info=tarfile.TarInfo(str(file.relative_to(tmp)));info.size=file.stat().st_size;info.mode=0o644
            with file.open('rb') as stream:tar.addfile(info,stream)
print(out,hashlib.sha256(out.read_bytes()).hexdigest())
