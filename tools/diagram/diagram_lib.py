import html, itertools, sys
S=48  # icon size (AWS standard 48)
ICON_GAP=14   # min clear space between icons
PAD=12        # min padding between a child and its group border (sides, bottom)
TITLE=30      # min distance from group top to first icon/child (title zone)
SIB=12        # min clear space between sibling groups
CW,LH=5.8,14  # label char width and line height (11 px font)
COL={'net':('#945DF2','#5A30B5'),'comp':('#F78E04','#D05C17'),'stor':('#60A337','#277116'),
     'db':('#4D72F3','#3334B9'),'sec':('#F54749','#C7131F'),'ml':('#4AB29A','#116D5B'),
     'mgmt':('#F34482','#BC1356'),'integ':('#F34482','#BC1356')}
icons={}   # id -> dict
groups={}  # id -> dict
edges=[]
def icon(id,cx,cy,label,res,cat,group,pos=None,standalone=None):
    icons[id]=dict(cx=cx,cy=cy,label=label,res=res,cat=cat,group=group,pos=pos,standalone=standalone)
def group(id,x,y,w,h,title,kind,parent=None):
    groups[id]=dict(x=x,y=y,w=w,h=h,title=title,kind=kind,parent=parent)
def edge(id,src,tgt,pts,label='',dashed=False,both=False,lx=0.0):
    # lx in [-1,1] moves the label along the edge (0 = middle, -1 = start, 1 = end)
    edges.append(dict(id=id,src=src,tgt=tgt,pts=pts,label=label,dashed=dashed,both=both,lx=lx))

# ---------- geometry helpers ----------
def irect(i): d=icons[i]; return (d['cx']-S/2,d['cy']-S/2,S,S)
def lsize(label):
    lines=label.split('\n'); return (max(len(l) for l in lines)*CW+8, len(lines)*LH+4)
CAND=['bottom','top','right','left','br','bl','tr','tl']
def lrect(i,pos):
    d=icons[i]; w,h=lsize(d['label']); x0,y0,_,_=irect(i); g=2
    if pos=='bottom': return (d['cx']-w/2,y0+S+g,w,h)
    if pos=='top':    return (d['cx']-w/2,y0-g-h,w,h)
    if pos=='right':  return (x0+S+g,d['cy']-h/2,w,h)
    if pos=='left':   return (x0-g-w,d['cy']-h/2,w,h)
    if pos=='br':     return (x0+S+g,y0+S+g,w,h)
    if pos=='bl':     return (x0-g-w,y0+S+g,w,h)
    if pos=='tr':     return (x0+S+g,y0-g-h,w,h)
    if pos=='tl':     return (x0-g-w,y0-g-h,w,h)
def inter(a,b,m=0):
    return not(a[0]+a[2]+m<=b[0] or b[0]+b[2]+m<=a[0] or a[1]+a[3]+m<=b[1] or b[1]+b[3]+m<=a[1])
def seg_rect(p,q,r):
    x1,y1=p;x2,y2=q
    rx=(min(x1,x2),min(y1,y2),abs(x2-x1),abs(y2-y1))
    return inter((rx[0],rx[1],max(rx[2],0.001),max(rx[3],0.001)),r)
def polyline(e):
    pts=e['pts']
    for a,b in zip(pts,pts[1:]): assert a[0]==b[0] or a[1]==b[1],(e['id'],a,b)
    return list(zip(pts,pts[1:]))
def on_same_line(s1,s2):
    (a,b),(c,d)=s1,s2
    if a[1]==b[1]==c[1]==d[1]:
        return max(min(a[0],b[0]),min(c[0],d[0]))<min(max(a[0],b[0]),max(c[0],d[0]))
    if a[0]==b[0]==c[0]==d[0]:
        return max(min(a[1],b[1]),min(c[1],d[1]))<min(max(a[1],b[1]),max(c[1],d[1]))
    return False
def gtitle_rect(g):
    off=30 if g['kind'] in ('aws','acct') else 8   # AWS group shapes draw a logo before the title
    return (g['x']+off-4,g['y']+4,len(g['title'])*6.6+10,20)
def gabs(gid): return groups[gid]
def edge_label_rect(e):
    if not e['label']: return None
    segs=polyline(e); L=sum(abs(b[0]-a[0])+abs(b[1]-a[1]) for a,b in segs); half=L/2*(1+e.get('lx',0)); acc=0
    for a,b in segs:
        l=abs(b[0]-a[0])+abs(b[1]-a[1])
        if acc+l>=half:
            t=(half-acc)/l if l else 0; x=a[0]+(b[0]-a[0])*t; y=a[1]+(b[1]-a[1])*t; break
        acc+=l
    w,h=lsize(e['label']); return (x-w/2,y-h/2,w,h)

# ---------- layout choice ----------
def choose_labels():
    """Pick a label position for every icon so no label hits an icon, an edge, an edge label, a
    group title or another label, and stays inside its group. Uses backtracking, most constrained first."""
    segs=[(e,a,b) for e in edges for a,b in polyline(e)]
    elr=[r for r in (edge_label_rect(e) for e in edges) if r]
    titles=[gtitle_rect(g) for g in groups.values()]
    options={}
    for i,d in icons.items():
        cands=[d['pos']] if d['pos'] else CAND
        ok=[]
        g=groups[d['group']]
        for c in cands:
            r=lrect(i,c)
            if any(inter(r,irect(j),2) for j in icons): continue
            if any(seg_rect(a,b,r) for e,a,b in segs): continue
            if any(inter(r,er,2) for er in elr): continue
            if any(inter(r,t,0) for t in titles): continue
            if not (r[0]>=g['x']+6 and r[1]>=g['y']+6 and r[0]+r[2]<=g['x']+g['w']-6 and r[1]+r[3]<=g['y']+g['h']-6): continue
            ok.append((c,r))
        options[i]=ok
    order=sorted(icons,key=lambda i:len(options[i]))
    fails=[i for i in order if not options[i]]
    order=[i for i in order if options[i]]
    chosen={}
    def dfs(k):
        if k==len(order): return True
        i=order[k]
        for c,r in options[i]:
            if all(not inter(r,rr,2) for _,rr in chosen.values()):
                chosen[i]=(c,r)
                if dfs(k+1): return True
                del chosen[i]
        return False
    if not dfs(0):
        fails=fails+['(no combination of label positions avoids clashes)']
    placed={i:chosen[i] if i in chosen else (icons[i]['pos'] or CAND[0],lrect(i,icons[i]['pos'] or CAND[0])) for i in icons}
    return placed,fails

def check(placed):
    errs=[]
    ids=list(icons)
    for a,b in itertools.combinations(ids,2):
        if inter(irect(a),irect(b),ICON_GAP): errs.append(f'icon gap<{ICON_GAP} {a},{b}')
    # edges vs icons (excluding endpoints) / labels
    for e in edges:
        for a,b in polyline(e):
            for j in ids:
                if j in (e['src'],e['tgt']): continue
                if seg_rect(a,b,irect(j)): errs.append(f"edge {e['id']} crosses icon {j}")
            for j,(pos,r) in placed.items():
                if seg_rect(a,b,r): errs.append(f"edge {e['id']} crosses label of {j}")
            for gid,g in groups.items():
                if seg_rect(a,b,gtitle_rect(g)): errs.append(f"edge {e['id']} crosses title {gid}")
    # edge labels
    elr={e['id']:edge_label_rect(e) for e in edges if e['label']}
    for eid,r in elr.items():
        for j in ids:
            if inter(r,irect(j),2): errs.append(f'edge label {eid} hits icon {j}')
        for j,(pos,lr) in placed.items():
            if inter(r,lr,2): errs.append(f'edge label {eid} hits label {j}')
        for gid,g in groups.items():
            if inter(r,gtitle_rect(g),0): errs.append(f'edge label {eid} hits title {gid}')
    # edge labels must sit on a clear stretch of their own line: no other edge and no group border through them
    for eid,r in elr.items():
        for e in edges:
            if e['id']==eid: continue
            own=polyline(next(x for x in edges if x['id']==eid))
            for a,b in polyline(e):
                shared=any(on_same_line((a,b),s) for s in own)   # bundled trunk, drawn as one line
                if not shared and seg_rect(a,b,r): errs.append(f"edge label {eid} crossed by edge {e['id']}")
        for gid,g in groups.items():
            x,y,w,h=g['x'],g['y'],g['w'],g['h']
            for a,b in (((x,y),(x+w,y)),((x+w,y),(x+w,y+h)),((x,y+h),(x+w,y+h)),((x,y),(x,y+h))):
                if seg_rect(a,b,r): errs.append(f'edge label {eid} sits on border of {gid}')
    # icon labels must not touch any group border either
    for i,(pos,r) in placed.items():
        for gid,g in groups.items():
            x,y,w,h=g['x'],g['y'],g['w'],g['h']
            for a,b in (((x,y),(x+w,y)),((x+w,y),(x+w,y+h)),((x,y+h),(x+w,y+h)),((x,y),(x,y+h))):
                if seg_rect(a,b,r): errs.append(f'label of {i} sits on border of {gid}')
    for (a,ra),(b,rb) in itertools.combinations(elr.items(),2):
        if inter(ra,rb,2): errs.append(f'edge labels overlap {a},{b}')
    # group containment & sibling overlap
    for i,d in icons.items():
        g=groups[d['group']]; r=irect(i)
        if not(r[0]>=g['x']+PAD and r[0]+r[2]<=g['x']+g['w']-PAD and r[1]>=g['y']+TITLE and r[1]+r[3]<=g['y']+g['h']-PAD):
            errs.append(f'icon {i} not padded in {d["group"]}')
        for tr in [gtitle_rect(g)]:
            if inter(r,tr,0): errs.append(f'icon {i} hits title of {d["group"]}')
    for a,b in itertools.combinations(groups,2):
        ga,gb=groups[a],groups[b]
        if ga['parent']==gb['parent'] and inter((ga['x'],ga['y'],ga['w'],ga['h']),(gb['x'],gb['y'],gb['w'],gb['h']),SIB):
            errs.append(f'sibling groups too close {a},{b}')
    for gid,g in groups.items():
        p=g['parent']
        if p:
            pg=groups[p]
            if not(g['x']>=pg['x']+PAD and g['y']>=pg['y']+TITLE and g['x']+g['w']<=pg['x']+pg['w']-PAD and g['y']+g['h']<=pg['y']+pg['h']-PAD):
                errs.append(f'group {gid} not padded in {p}')
    return errs

# ---------- XML ----------
def esc(t): return html.escape(t,quote=True)
def lab(t): return esc(t.replace('\n','<br>'))
LABELSTYLE={'bottom':'labelPosition=center;align=center;verticalLabelPosition=bottom;verticalAlign=top;',
 'top':'labelPosition=center;align=center;verticalLabelPosition=top;verticalAlign=bottom;',
 'right':'labelPosition=right;align=left;verticalLabelPosition=middle;verticalAlign=middle;',
 'left':'labelPosition=left;align=right;verticalLabelPosition=middle;verticalAlign=middle;',
 'br':'labelPosition=right;align=left;verticalLabelPosition=bottom;verticalAlign=top;',
 'bl':'labelPosition=left;align=right;verticalLabelPosition=bottom;verticalAlign=top;',
 'tr':'labelPosition=right;align=left;verticalLabelPosition=top;verticalAlign=bottom;',
 'tl':'labelPosition=left;align=right;verticalLabelPosition=top;verticalAlign=bottom;'}
GSTYLE={
 'aws':"points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=11;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;",
 'acct':"points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=11;fontStyle=1;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_account;strokeColor=#CD2264;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#CD2264;dashed=0;",
 'ext':"rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;fillColor=#F2F4F8;strokeColor=#4B5A78;strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#3C4A66;fontSize=11;",
 'edge':"rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;fillColor=#FFFFFF;strokeColor=#4B5A78;strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#3C4A66;fontSize=11;",
 'backend':"rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;fillColor=#F7F4FF;strokeColor=#8C4FFF;strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#7B3FF2;fontSize=11;",
 'agentcore':"rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;fillColor=#F1FBF8;strokeColor=#01A88D;strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#067F6B;fontSize=11;",
 'secops':"rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;fillColor=#FFF5F6;strokeColor=#DD344C;strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#DD344C;fontSize=11;",
 'tools':"rounded=1;arcSize=2;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;fillColor=#FFF8F0;strokeColor=#ED7100;strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#C25E00;fontSize=11;"}

def build(placed):
    out=[]
    def rel(gid,x,y):
        g=groups[gid]; return x-g['x'],y-g['y']
    def chain(gid):
        c=[];
        while gid: c.append(gid); gid=groups[gid]['parent']
        return c
    # groups in parent-first order
    def depth(g): return len(chain(g))
    for gid in sorted(groups,key=depth):
        g=groups[gid]; p=g['parent']
        x,y=(g['x'],g['y']) if not p else rel(p,g['x'],g['y'])
        out.append(f'<mxCell id="{gid}" value="{lab(g["title"])}" style="{GSTYLE[g["kind"]]}" vertex="1" parent="{p or 1}"><mxGeometry x="{x:g}" y="{y:g}" width="{g["w"]:g}" height="{g["h"]:g}" as="geometry"/></mxCell>')
    for i,d in icons.items():
        pos=placed[i][0]; x0,y0,_,_=irect(i); rx,ry=rel(d['group'],x0,y0) if d['group'] else (x0,y0)
        if d['standalone']:
            st=(f"sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor={d['standalone']};strokeColor=none;dashed=0;{LABELSTYLE[pos]}html=1;fontSize=11;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.{d['res']};")
        else:
            g,f=COL[d['cat']]
            st=(f"sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor={g};gradientDirection=north;fillColor={f};strokeColor=#ffffff;dashed=0;{LABELSTYLE[pos]}html=1;fontSize=11;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.{d['res']};")
        out.append(f'<mxCell id="{i}" value="{lab(d["label"])}" style="{st}" vertex="1" parent="{d["group"] or 1}"><mxGeometry x="{rx:g}" y="{ry:g}" width="{S}" height="{S}" as="geometry"/></mxCell>')
    def bounds(i):
        if i in icons: return irect(i)
        g=groups[i]; return (g['x'],g['y'],g['w'],g['h'])
    for e in edges:
        sx,sy=e['pts'][0]; tx,ty=e['pts'][-1]; sb=bounds(e['src']); tb=bounds(e['tgt'])
        ex,ey=(sx-sb[0])/sb[2],(sy-sb[1])/sb[3]; nx,ny=(tx-tb[0])/tb[2],(ty-tb[1])/tb[3]
        st=(f"edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;jumpStyle=arc;jumpSize=8;endArrow=block;endFill=1;strokeColor=#232F3E;strokeWidth=1.25;fontSize=10;fontColor=#232F3E;labelBackgroundColor=#ffffff;"
            f"exitX={ex:.4f};exitY={ey:.4f};exitDx=0;exitDy=0;entryX={nx:.4f};entryY={ny:.4f};entryDx=0;entryDy=0;")
        if e['dashed']: st+="dashed=1;dashPattern=8 6;"
        if e['both']: st+="startArrow=block;startFill=1;"
        mid=e['pts'][1:-1]
        arr=('<Array as="points">'+''.join(f'<mxPoint x="{a:g}" y="{b:g}"/>' for a,b in mid)+'</Array>') if mid else ''
        lxa=f' x="{e.get("lx",0):g}"' if e.get('lx') else ''
        out.append(f'<mxCell id="{e["id"]}" value="{lab(e["label"])}" style="{st}" edge="1" parent="1" source="{e["src"]}" target="{e["tgt"]}"><mxGeometry{lxa} relative="1" as="geometry">{arr}</mxGeometry></mxCell>')
    return out


def report():
    """Print canvas size and how full each group is (icons + labels area / group area)."""
    xs=[g['x']+g['w'] for g in groups.values()]; ys=[g['y']+g['h'] for g in groups.values()]
    print(f'canvas about {max(xs):.0f} x {max(ys):.0f} px')
    for gid,g in groups.items():
        used=0
        for i,d in icons.items():
            if d['group']==gid:
                used+=S*S+lsize(d['label'])[0]*lsize(d['label'])[1]
        if used: print(f"  fill {gid:10s} {100*used/(g['w']*g['h']):4.0f}%  ({g['w']:.0f} x {g['h']:.0f})")


def explain(i):
    """Print why each label position fails for icon i (debug helper)."""
    placed={}
    for c in CAND:
        r=lrect(i,c); why=[]
        for j in icons:
            if j!=i and inter(r,irect(j),2): why.append('icon '+j)
        for e in edges:
            for a,b in polyline(e):
                if seg_rect(a,b,r): why.append('edge '+e['id'])
            er=edge_label_rect(e)
            if er and inter(r,er,2): why.append('elabel '+e['id'])
        for gid,g in groups.items():
            if inter(r,gtitle_rect(g),0): why.append('title '+gid)
        g=groups[icons[i]['group']]
        if not (r[0]>=g['x']+6 and r[1]>=g['y']+6 and r[0]+r[2]<=g['x']+g['w']-6 and r[1]+r[3]<=g['y']+g['h']-6): why.append('outside group')
        print(f'  {i:10s} {c:6s}',[round(v) for v in r],sorted(set(why)))


def diagnose():
    """List icons with few free label positions and label pairs that can never coexist."""
    segs=[(e,a,b) for e in edges for a,b in polyline(e)]
    elr=[r for r in (edge_label_rect(e) for e in edges) if r]
    titles=[gtitle_rect(g) for g in groups.values()]
    opts={}
    for i,d in icons.items():
        g=groups[d['group']]; ok=[]
        for c in ([d['pos']] if d['pos'] else CAND):
            r=lrect(i,c)
            if any(inter(r,irect(j),2) for j in icons): continue
            if any(seg_rect(a,b,r) for e,a,b in segs): continue
            if any(inter(r,er,2) for er in elr): continue
            if any(inter(r,t,0) for t in titles): continue
            if not (r[0]>=g['x']+6 and r[1]>=g['y']+6 and r[0]+r[2]<=g['x']+g['w']-6 and r[1]+r[3]<=g['y']+g['h']-6): continue
            ok.append((c,r))
        opts[i]=ok
    for i,o in sorted(opts.items(),key=lambda kv:len(kv[1])):
        if len(o)<=1: print('  few options:',i,[c for c,_ in o])
    for a,b in itertools.combinations(opts,2):
        if opts[a] and opts[b] and all(inter(ra,rb,2) for _,ra in opts[a] for _,rb in opts[b]):
            print('  impossible pair:',a,b,[c for c,_ in opts[a]],[c for c,_ in opts[b]])
