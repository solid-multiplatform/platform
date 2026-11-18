"""Record three physical Android gallery passes. Keep raw traces on the test machine."""
import argparse, hashlib, json, pathlib, subprocess, uuid
p=argparse.ArgumentParser()
p.add_argument('--serial',required=True);p.add_argument('--out',type=pathlib.Path,required=True)
p.add_argument('--package',required=True);p.add_argument('--seconds',type=int,default=600)
p.add_argument('--passes',type=int,default=3)
args=p.parse_args()
adb=['adb','-s',args.serial]
def shell(*words):return subprocess.check_output(adb+['shell',*words],text=True).strip()
args.out.mkdir(parents=True,exist_ok=True)
model=shell('getprop','ro.product.model');firmware=shell('getprop','ro.build.fingerprint')
for i in range(1,args.passes+1):
    pid=shell('pidof',args.package)
    if shell('run-as',args.package,'cat','files/workload-ready')!='gallery':raise RuntimeError('Scene not ready')
    remote='/data/misc/perfetto-traces/solid-'+uuid.uuid4().hex+'.perfetto-trace'
    local=args.out/('pass-%d.perfetto-trace'%i)
    config=f"""buffers {{ size_kb: 32768 fill_policy: RING_BUFFER }}
data_sources {{ config {{ name: "android.surfaceflinger.frametimeline" }} }}
duration_ms: {1000*args.seconds}
write_into_file: true
file_write_period_ms: 2000
"""
    subprocess.run(adb+['shell','perfetto','--txt','-c','-','-o',remote],input=config,text=True,check=True)
    subprocess.run(adb+['pull',remote,str(local)],check=True)
    shell('rm',remote)
    if shell('pidof',args.package)!=pid:raise RuntimeError('Workload restarted during trace')
    record={'model':model,'firmware':firmware,'package':args.package,'pass':i,'seconds':args.seconds,
            'sha256':hashlib.sha256(local.read_bytes()).hexdigest(),'scope':'artwork-and-scroll','releaseStatus':'preview'}
    (args.out/f'pass-{i}.json').write_text(json.dumps(record,indent=2)+'\n')
    print(local,flush=True)
