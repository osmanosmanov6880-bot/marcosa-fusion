#!/usr/bin/env python3
"""R109: safe public DNS/TLS readiness check for an independent preview origin.

Fixed hostname + pinned intended Contabo address, no authentication, no
configuration changes. Never treats TLS reachability as production authorization.
"""
from __future__ import annotations
import json
import re
import socket
import ssl
import sys

PREVIEW="preview.marcosa.club"
EXPECTED_VPS_IP="169.58.48.38"
HOST_TIMEOUT=7
MAX_RESPONSE=2048


def resolve_ipv4(name:str)->list[str]:
    info=socket.getaddrinfo(name,443,family=socket.AF_INET,type=socket.SOCK_STREAM)
    return sorted(set(row[4][0] for row in info))


def https_probe(ip:str,hostname:str)->dict:
    ctx=ssl.create_default_context()
    with socket.create_connection((ip,443),timeout=HOST_TIMEOUT) as tcp:
        with ctx.wrap_socket(tcp,server_hostname=hostname) as tls:
            tls.settimeout(HOST_TIMEOUT)
            version=tls.version()
            certificate=tls.getpeercert()
            tls.sendall((
                "HEAD / HTTP/1.1\r\n"
                "Host: "+hostname+"\r\n"
                "Connection: close\r\n"
                "User-Agent: MARCOSA-R109-readonly\r\n\r\n"
            ).encode("ascii"))
            head=tls.recv(MAX_RESPONSE).split(b"\r\n",1)[0].decode("ascii",errors="replace")
            found=re.fullmatch(r"HTTP/1\.[01] (\d{3})(?: [^\r\n]*)?",head)
            status=int(found.group(1)) if found else None
            return {"validHostnameCertificate":True,"tlsVersion":version,
                    "certificateNotAfter":certificate.get("notAfter"),
                    "httpStatus":status,"httpHeadReachable":bool(status is not None)}


def audit(resolve_fn=resolve_ipv4,probe_fn=https_probe)->dict:
    result={
        "format":"MARCOSA-R109-INDEPENDENT-ORIGIN-READINESS",
        "targetHostname":PREVIEW,
        "intendedVpsIp":EXPECTED_VPS_IP,
        "ipv4Answers":[],
        "dnsHasIntendedVps":False,
        "tlsChecked":False,
        "validHostnameCertificate":False,
        "httpHeadReachable":False,
        "httpStatus":None,
        "previewHostnameReady":False,
        "webStorageIsSeparateFromMainHostname":True,
        "crossSubdomainCookieIsolationVerified":False,
        "legacyAuthStorageInspected":False,
        "staticSiteInstalledOnSubdomain":False,
        "productionCutoverAuthorized":False,
        "readOnly":True,
        "notes":"An independent hostname isolates localStorage/IndexedDB; Domain-scoped cookies still require review."
    }
    try:
        ips=resolve_fn(PREVIEW)
        if not isinstance(ips,list) or len(ips)>20 or any(not re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}",x) for x in ips):
            raise ValueError("Unexpected DNS IPv4 result")
        result["ipv4Answers"]=sorted(set(ips))
        result["dnsHasIntendedVps"]=EXPECTED_VPS_IP in ips
    except (socket.gaierror,TimeoutError,OSError,ValueError):
        result["dnsErrorClass"]="DNS_UNAVAILABLE_OR_UNEXPECTED"
        return result
    if not result["dnsHasIntendedVps"]:
        result["dnsErrorClass"]="DOES_NOT_RESOLVE_TO_APPROVED_VPS"
        return result
    result["tlsChecked"]=True
    try:
        details=probe_fn(EXPECTED_VPS_IP,PREVIEW)
        result.update({k:details[k] for k in
            ("validHostnameCertificate","tlsVersion","certificateNotAfter",
             "httpStatus","httpHeadReachable") if k in details})
        result["previewHostnameReady"]=(
            result["validHostnameCertificate"] is True and
            result["httpHeadReachable"] is True and
            isinstance(result["httpStatus"],int) and
            200<=result["httpStatus"]<400
        )
    except (socket.timeout,ConnectionError,OSError,ssl.SSLError,ValueError):
        result["tlsErrorClass"]="TLS_OR_HTTP_NOT_READY"
    return result


def main():
    if len(sys.argv)!=1:
        raise ValueError("No arguments accepted; fixed approved target only")
    r=audit()
    print(json.dumps(r,sort_keys=True))
    print("R109_READONLY_ORIGIN_AUDIT=PASS")
    print("PREVIEW_HOST_READY="+("YES" if r["previewHostnameReady"] else "NO"))
    print("PRODUCTION_ROOT_UNCHANGED=YES")


if __name__=="__main__":
    try:
        main()
    except (OSError,ValueError) as e:
        print("R109_READONLY_ORIGIN_AUDIT=BLOCKED "+type(e).__name__,file=sys.stderr)
        raise SystemExit(2)
