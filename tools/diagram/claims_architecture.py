"""Layout spec for docs/architecture.drawio. Edit this file, then run tools/diagram/build.sh.
Compact on purpose: small gaps, groups sized to their content, one main row (SP).
Coordinates are absolute pixels. Icons are 48x48. Edges list explicit waypoints from port to port."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diagram_lib import *
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'architecture.drawio')

# ---- grid ----
Y0=160                 # top of the group band
TOP=122                # centre line of the loose top band (S3 console, DynamoDB)
RA=Y0+55; SP=RA+116; RC=SP+104   # rows: above main row, main row, below main row
GB=RC+57+12            # bottom of the group band
SY=GB+14               # top of the bottom band
BY=SY+54               # icon centre line of the bottom band
BOT=BY+58+12           # bottom of the bottom band
BUS=686                # vertical channel that collects the DynamoDB edges
# ---- groups ----
group('aws',152,4,924,BOT+12+12-4,'AWS Cloud','aws')
group('acct',165,40,897,BOT+12-40,'Claims AWS account · us-east-1','acct','aws')
group('users',4,262,134,142,'Users','ext')
group('edge',180,Y0,178,GB-Y0,'Edge','edge','acct')
group('backend',370,Y0,310,GB-Y0,'Backend','backend','acct')
group('agentcore',692,Y0,220,GB-Y0,'Bedrock AgentCore','agentcore','acct')
group('bedrock',924,Y0,124,GB-Y0,'Bedrock','agentcore','acct')
group('secops',180,SY,500,BOT-SY,'Security & ops','secops','acct')
group('tools',692,SY,356,BOT-SY,'Gateway targets (read-only)','tools','acct')
# ---- icons ----
icon('client',72,SP,'React console\nCustomer, Adjuster','client',None,'users',standalone='#232F3E')
icon('s3web',250,TOP,'S3 (private)\nconsole, OAC','s3','stor','acct','right')
icon('cf',250,RA,'CloudFront\nHTTPS only','cloudfront','net','edge')
icon('apigw',312,SP,'API Gateway\nHTTP API','api_gateway','net','edge')
icon('cog',250,RC,'Cognito\nsign-in','cognito','sec','edge')
icon('s3ev',626,RA,'S3 evidence\n(private)','s3','stor','backend')
icon('proc',518,RA,'Evidence\nProcessor','lambda','comp','backend')
icon('apil',410,SP,'API Lambda\nroutes','lambda','comp','backend')
icon('queue',518,SP,'SQS queue','sqs','integ','backend')
icon('worker',626,SP,'Worker','lambda','comp','backend')
icon('dlq',518,RC,'SQS DLQ','sqs','integ','backend')
icon('decision',626,RC,'Decision Lambda\napprove / route','lambda','comp','backend')
icon('ddb',770,TOP,'DynamoDB (on-demand)\nPolicies, Claims, EvidenceIndex,\nClaimTypePacks, AuditLog','dynamodb','db','acct','top')
icon('gateway',748,250,'Gateway\nMCP, IAM auth','bedrock_agentcore','ml','agentcore')
icon('interceptor',860,250,'Interceptor\nverify ticket','lambda','comp','agentcore')
icon('runtime',748,SP,'Runtime\nagent','bedrock_agentcore','ml','agentcore')
icon('obs',748,RC,'AgentCore\nObservability','bedrock_agentcore','ml','agentcore')
icon('claude',986,245,'Claude Haiku 5.5\nvision, tool use','bedrock','ml','bedrock')
icon('guard',986,401,'Guardrails\nprompt attack','bedrock','ml','bedrock')
icon('t1',750,BY,'lookup_policy','lambda','comp','tools')
icon('t2',862,BY,'check_fraud_\nsignals','lambda','comp','tools')
icon('t3',974,BY,'verify_evidence','lambda','comp','tools')
icon('cw',240,BY,'CloudWatch\nlogs, metrics','cloudwatch_2','mgmt','secops')
icon('ct',335,BY,'CloudTrail\nAPI audit','cloudtrail','mgmt','secops')
icon('kms',430,BY,'KMS\ndata, ticket keys','key_management_service','sec','secops')
icon('iam',525,BY,'IAM roles\nper Lambda','identity_and_access_management','sec','secops')
icon('ssm',620,BY,'SSM Parameters\nkill switch','systems_manager','mgmt','secops')
# ---- edges (absolute waypoints) ----
H=24  # half icon
edge('e1','client','s3ev',[(72,SP-H),(72,80),(626,80),(626,RA-H)],'1 presigned POST')
edge('e2','client','apigw',[(96,SP),(288,SP)],'2 submit',lx=0.55)
edge('e3','client','cf',[(96,SP),(202,SP),(202,RA),(226,RA)])
edge('e4','client','cog',[(96,SP),(202,SP),(202,RC),(226,RC)])
edge('e5','cf','s3web',[(250,RA-H),(250,TOP+H)])
edge('e6','cog','apigw',[(274,RC),(312,RC),(312,SP+H)],'JWT',dashed=True)
edge('e7','apigw','apil',[(336,SP),(386,SP)])
edge('e8','apil','queue',[(434,SP),(494,SP)],'3 send')
edge('e9','queue','worker',[(542,SP),(602,SP)],'poll')
edge('e10','queue','dlq',[(518,SP+H),(518,RC-H)],'3 tries',dashed=True)
edge('e11','dlq','decision',[(542,RC),(602,RC)],'route',dashed=True)
edge('e12','s3ev','proc',[(602,RA),(542,RA)],'event')
edge('e13','worker','s3ev',[(626,SP-H),(626,RA+H)],'read')
edge('e14','worker','runtime',[(650,SP),(724,SP)],'4',lx=-0.5)
edge('e15','worker','decision',[(626,SP+H),(626,RC-H)],'7 decide')
edge('e16','runtime','gateway',[(748,SP-H),(748,250+H)],'5 MCP')
edge('e17','gateway','interceptor',[(772,250),(836,250)],'auth')
edge('e18','interceptor','ddb',[(860,250-H),(860,TOP),(794,TOP)],'status')
edge('e19','runtime','claude',[(772,SP),(918,SP),(918,245),(962,245)],'6 Converse,\nApplyGuardrail',lx=-0.4)
edge('e20','runtime','guard',[(772,SP),(918,SP),(918,401),(962,401)])
edge('e21','runtime','obs',[(748,SP+H),(748,RC-H)],'traces',dashed=True)
edge('e22','gateway','tools',[(724,250),(716,250),(716,SY)])
edge('e23','tools','ddb',[(692,BY),(BUS,BY),(BUS,TOP),(746,TOP)])
edge('e24','proc','ddb',[(518,RA-H),(518,152),(BUS,152),(BUS,TOP),(746,TOP)])
edge('e26','decision','ddb',[(650,RC),(BUS,RC),(BUS,TOP),(746,TOP)])
edge('e27','apil','ddb',[(410,SP+H),(410,GB+7),(BUS,GB+7),(BUS,TOP),(746,TOP)])
if "--diagnose" in sys.argv: diagnose()
placed,fails=choose_labels()
errs=check(placed)
print('label fails:',fails)
print('errors:',len(errs)); [print(' ',e) for e in errs]
print({k:v[0] for k,v in placed.items()})
if errs or fails: sys.exit(1)
report()
if '--write' in sys.argv:
    body=build(placed)
    LY=BOT+12+12+14   # legend row, just below the AWS Cloud group
    T='fontSize=11;fontColor=#232F3E;'
    legend=[
     f'<mxCell id="lg_t" value="&lt;b&gt;Legend&lt;/b&gt;" style="text;html=1;align=left;verticalAlign=middle;{T}" vertex="1" parent="1"><mxGeometry x="165" y="{LY-10}" width="50" height="20" as="geometry"/></mxCell>',
     f'<mxCell id="lg_a" value="" style="endArrow=block;endFill=1;html=1;strokeColor=#232F3E;strokeWidth=1.5;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="220" y="{LY}" as="sourcePoint"/><mxPoint x="270" y="{LY}" as="targetPoint"/></mxGeometry></mxCell>',
     f'<mxCell id="lg_at" value="request / sync call" style="text;html=1;align=left;verticalAlign=middle;{T}" vertex="1" parent="1"><mxGeometry x="276" y="{LY-10}" width="110" height="20" as="geometry"/></mxCell>',
     f'<mxCell id="lg_b" value="" style="endArrow=block;endFill=1;html=1;strokeColor=#232F3E;strokeWidth=1.5;dashed=1;dashPattern=6 4;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="396" y="{LY}" as="sourcePoint"/><mxPoint x="446" y="{LY}" as="targetPoint"/></mxGeometry></mxCell>',
     f'<mxCell id="lg_bt" value="async / traces / fail-safe" style="text;html=1;align=left;verticalAlign=middle;{T}" vertex="1" parent="1"><mxGeometry x="452" y="{LY-10}" width="150" height="20" as="geometry"/></mxCell>',
     f'<mxCell id="lg_c" value="1-7 claim steps. One least-privilege IAM role per Lambda. Only the Decision Lambda writes AUTO_APPROVED or ROUTED_TO_ADJUSTER; the agent is read-only. Tool calls: IAM auth plus a KMS-signed ticket for one claim; user tokens stop at API Gateway. Not drawn (pilot): VPC endpoints, WAF, Fargate worker, CloudWatch Omni." style="text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;{T}" vertex="1" parent="1"><mxGeometry x="165" y="{LY+12}" width="910" height="32" as="geometry"/></mxCell>']
    W=1080; Hh=LY+50
    xml=(f'<mxfile host="app.diagrams.net" version="24.0.0"><diagram id="claims-arch" name="Instant Claims Agent"><mxGraphModel dx="{W}" dy="{Hh}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{W}" pageHeight="{Hh}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>\n'
      +'\n'.join(body+legend)+'\n</root></mxGraphModel></diagram></mxfile>\n')
    import xml.etree.ElementTree as E; E.fromstring(xml)
    open(OUT,'w').write(xml); print('written',os.path.normpath(OUT))
