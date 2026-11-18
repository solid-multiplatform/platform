"""Export only the fixture layer's presentation timings. This lane can rule out a release."""
import argparse, csv, gzip, hashlib, io, json, pathlib, re, subprocess
p=argparse.ArgumentParser()
p.add_argument('trace_directory',type=pathlib.Path)
p.add_argument('--processor',required=True);p.add_argument('--out',type=pathlib.Path,required=True)
args=p.parse_args(); args.out.mkdir(exist_ok=True,parents=True)
reports=[]
for meta in sorted(args.trace_directory.glob('pass-*.json')):
    record=json.loads(meta.read_text())
    trace=meta.with_suffix('.perfetto-trace')
    if hashlib.sha256(trace.read_bytes()).hexdigest()!=record['sha256']:raise ValueError('Trace hash mismatch')
    app=record['package']
    if not re.fullmatch(r'[A-Za-z0-9_.]+',app):raise ValueError('Invalid package id')
    sql=f"""SELECT ts,dur,surface_frame_token,present_type,jank_type,layer_name
        FROM actual_frame_timeline_slice
        WHERE instr(layer_name,'{app}/')>0 ORDER BY ts"""
    output=subprocess.check_output([args.processor,'query','--no-agent','--format','csv',str(trace),sql],text=True,stderr=subprocess.DEVNULL)
    rows=list(csv.DictReader(io.StringIO(output)))
    counts={}
    for row in rows:
        key=row['present_type']+' / '+row['jank_type'];counts[key]=counts.get(key,0)+1
    misses=sum(r['present_type'] in ('Late Present','Dropped Frame') or 'Deadline Missed' in r['jank_type'] for r in rows)
    span=(int(rows[-1]['ts'])-int(rows[0]['ts']))/1e9 if rows else 0
    with gzip.GzipFile(str(args.out/(meta.stem+'-frames.csv.gz')),'wb',mtime=0) as f:f.write(output.encode())
    reports.append({**record,'appFrames':len(rows),'sampleSpanSeconds':round(span,2),'misses':misses,'presentation':counts})
summary={'status':'preview','reason':'Missed presentation deadlines' if any(r['misses'] for r in reports) else 'Full scenario coverage and active-frame expectation evidence required','passes':reports}
(args.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps([(r['pass'],r['appFrames'],r['misses']) for r in reports]))
