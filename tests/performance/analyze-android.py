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
    sql=f"""SELECT a.ts,a.dur,a.surface_frame_token,a.present_type,a.jank_type,a.layer_name,
                   a.display_frame_token,d.ts+d.dur AS display_present_ns
        FROM actual_frame_timeline_slice a
        LEFT JOIN actual_frame_timeline_slice d
          ON a.display_frame_token=d.display_frame_token AND d.layer_name IS NULL
          AND d.dur>=0 AND (d.surface_frame_token IS NULL OR d.surface_frame_token=0)
        WHERE instr(a.layer_name,'{app}/')>0 ORDER BY a.ts"""
    output=subprocess.check_output([args.processor,'query','--no-agent','--format','csv',str(trace),sql],text=True,stderr=subprocess.DEVNULL)
    rows=list(csv.DictReader(io.StringIO(output)))
    counts={}
    for row in rows:
        key=row['present_type']+' / '+row['jank_type'];counts[key]=counts.get(key,0)+1
    misses=sum(r['present_type'] in ('Late Present','Dropped Frame') or 'Deadline Missed' in r['jank_type'] for r in rows)
    span=(int(rows[-1]['ts'])-int(rows[0]['ts']))/1e9 if rows else 0
    # This fixture rests for 200 ms after each 300 ms movement. Isolate short
    # double-refresh intervals from those intentional pauses at 60 Hz.
    presents=sorted({int(r['display_present_ns']) for r in rows if r['display_present_ns'].isdigit()})
    intervals=[(b-a)/1e6 for a,b in zip(presents,presents[1:])]
    cadence={'matchedDisplayFrames':len(presents),'intervals25To100ms':sum(25<=v<100 for v in intervals)}
    with gzip.GzipFile(str(args.out/(meta.stem+'-frames.csv.gz')),'wb',mtime=0) as f:f.write(output.encode())
    reports.append({**record,'appFrames':len(rows),'sampleSpanSeconds':round(span,2),'misses':misses,'presentation':counts,'cadence60Hz':cadence})
reason='Full scenario coverage and active-frame expectation evidence required'
if not reports or any(not r['appFrames'] or not r['cadence60Hz']['matchedDisplayFrames'] for r in reports):
    reason='Missing application or display frame timing'
elif any(r['misses'] for r in reports):
    reason='Missed presentation deadlines'
elif any(r['cadence60Hz']['intervals25To100ms'] for r in reports):
    reason='Short multi-refresh gaps in the 60 Hz gallery workload'
summary={'status':'preview','reason':reason,'passes':reports}
(args.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps([(r['pass'],r['appFrames'],r['misses']) for r in reports]))
