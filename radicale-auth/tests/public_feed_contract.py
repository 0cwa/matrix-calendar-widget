import argparse
import base64
import configparser
import http.client
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import radicale

AUTH_SRC = pathlib.Path(__file__).resolve().parents[1] / 'src'
assert radicale.VERSION == '3.8.0', ('pinned Radicale version', radicale.VERSION)
parser = argparse.ArgumentParser()
parser.add_argument(
    '--radicale-config',
    type=pathlib.Path,
    default=pathlib.Path(__file__).resolve().parents[1] / 'config',
)
args = parser.parse_args()
project_config = configparser.ConfigParser()
if not project_config.read(args.radicale_config):
    raise FileNotFoundError(
        f'Radicale config could not be read: {args.radicale_config}'
    )
assert project_config.get('rights', 'type') == 'owner_only', ('project rights config', project_config.get('rights', 'type', fallback=None))
expected_sharing_config = {
    'type': 'files',
    'collection_by_token': 'True',
    'collection_by_map': 'False',
    'permit_create_token': 'True',
    'permit_create_map': 'False',
    'permit_properties_overlay': 'False',
    'default_permissions_create_token': 'r',
}
actual_sharing_config = dict(project_config.items('sharing'))
assert actual_sharing_config == expected_sharing_config, ('project native sharing config', actual_sharing_config)

class UserInfoHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        access = query.get('access_token', [''])[0]
        localpart = access.removeprefix('openid-')
        if parsed.path != '/_matrix/federation/v1/openid/userinfo' or localpart not in {'alice', 'calendarbot'}:
            self.send_response(401)
            self.end_headers()
            return
        data = json.dumps({'sub': f'@{localpart}:example.test'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def credential(localpart):
    payload = json.dumps({'access_token': f'openid-{localpart}', 'matrix_server_name': 'example.test'}, separators=(',', ':')).encode()
    return 'Basic ' + base64.b64encode(f'{localpart}:matrix-openid:{base64.urlsafe_b64encode(payload).decode().rstrip("=")}'.encode()).decode()


def request(port, method, path, *, body=b'', auth=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    request_headers = dict(headers or {})
    if auth:
        request_headers['Authorization'] = auth
    if body and 'Content-Length' not in request_headers:
        request_headers['Content-Length'] = str(len(body))
    connection.request(method, path, body=body, headers=request_headers)
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result


def wait_ready(proc, port):
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError('Radicale exited: ' + (proc.stdout.read() if proc.stdout else ''))
        try:
            status, _, _ = request(port, 'GET', '/')
            if status in {200, 302, 401, 403}:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise RuntimeError('Radicale readiness timed out')


def start_radicale(config_path, data_path, port, userinfo_port):
    env = os.environ.copy()
    env['PYTHONPATH'] = os.pathsep.join(
        part for part in (str(AUTH_SRC), env.get('PYTHONPATH', '')) if part
    )
    env['RADICALE_MATRIX_HOMESERVER_URL'] = f'http://127.0.0.1:{userinfo_port}'
    env['RADICALE_MATRIX_SERVER_NAME'] = 'example.test'
    return subprocess.Popen([sys.executable, '-m', 'radicale', '--config', str(config_path)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


ics = '''BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Matrix Calendar Widget//Share contract//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Canonical team calendar\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Stockholm\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:feed-contract-event\r\nDTSTAMP:20261021T100000Z\r\nDTSTART;TZID=Europe/Stockholm:20261022T090000\r\nDTEND;TZID=Europe/Stockholm:20261022T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3\r\nSUMMARY:Canonical round trip\r\nX-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'''.encode()
mkcalendar = b'''<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:set><d:prop><d:displayname>Synthetic VEVENT test calendar</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>'''

with tempfile.TemporaryDirectory(prefix='mcw-public-feed-contract-') as raw_temp:
    temp = pathlib.Path(raw_temp)
    collections = temp / 'collections'
    collections.mkdir()
    port = free_port()
    userinfo = ThreadingHTTPServer(('127.0.0.1', 0), UserInfoHandler)
    userinfo_port = userinfo.server_address[1]
    threading.Thread(target=userinfo.serve_forever, daemon=True).start()
    config = temp / 'config'
    config.write_text(f'''[server]\nhosts = 127.0.0.1:{port}\nmax_connections = 4\nmax_content_length = 1048576\nmax_resource_size = 1048576\ntimeout = 5\n\n[auth]\ntype = matrix_calendar_radicale_auth\ncache_logins = False\nlc_username = False\nuc_username = False\nstrip_domain = False\nurldecode_username = False\ndelay = 0\n\n[rights]\ntype = owner_only\n\n[storage]\ntype = multifilesystem\nfilesystem_folder = {collections}\n\n[sharing]\ntype = files\ncollection_by_token = True\ncollection_by_map = False\npermit_create_token = True\npermit_create_map = False\npermit_properties_overlay = False\ndefault_permissions_create_token = r\n\n[logging]\nlevel = trace\nmask_passwords = True\n''')
    process = start_radicale(config, collections, port, userinfo_port)
    logs = []
    try:
        wait_ready(process, port)
        owner = credential('alice')
        status, _, _ = request(port, 'MKCALENDAR', '/alice/team/', body=mkcalendar, auth=owner, headers={'Content-Type': 'application/xml; charset=utf-8'})
        assert status in {201, 207}, ('MKCALENDAR', status)
        status, _, _ = request(port, 'PUT', '/alice/team/event.ics', body=ics, auth=owner, headers={'Content-Type': 'text/calendar'})
        assert status in {201, 204}, ('PUT event', status)
        status, _, _ = request(port, 'GET', '/alice/team/')
        assert status in {401, 403}, ('private canonical URL was reachable without proof', status)

        status, empty_list_headers, empty_list_body = request(port, 'POST', '/.sharing/v1/token/list', body=json.dumps({'PathMapped': '/alice/team/'}).encode(), auth=owner, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status == 200, ('list shares before first create', status, empty_list_body[:500])
        assert 'json' in empty_list_headers.get('Content-Type', '').lower(), ('empty share list content type', empty_list_headers)
        empty_list = json.loads(empty_list_body)
        assert empty_list.get('Status') == 'not-found' and empty_list.get('Content') == [], ('empty share list response', empty_list)

        create = json.dumps({'PathMapped': '/alice/team/', 'Permissions': 'r', 'Conversion': 'none', 'Enabled': True, 'Hidden': False, 'Properties': {'D:displayname': 'Matrix Calendar Widget public feed'}}).encode()
        status, create_headers, create_body = request(port, 'POST', '/.sharing/v1/token/create', body=create, auth=owner, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status == 200, ('create share', status, create_body[:500])
        created = json.loads(create_body)
        path = created.get('PathOrToken')
        assert isinstance(path, str) and path.startswith('/.token/v1/') and path.endswith('/'), ('token path version', created)
        assert len(path.rsplit('/', 2)[-2]) == 44, ('token length', len(path.rsplit('/', 2)[-2]))

        status, headers, body = request(port, 'GET', path)
        assert status == 200, ('anonymous token GET', status, body[:300])
        assert 'text/calendar' in headers.get('Content-Type', '').lower(), ('content type', headers)
        for expected in ('TZID:Europe/Stockholm', 'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3', 'X-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value', 'keep-this-value'):
            assert expected in body.decode(), ('canonical property missing', expected, body[:1000])
        assert b'BEGIN:VTODO' not in body and b'BEGIN:VJOURNAL' not in body, ('unexpected unsupported component in VEVENT-only feed', body[:1500])
        assert b'X-WR-CALNAME;VALUE=TEXT:Synthetic VEVENT test calendar' in body, ('Radicale collection displayname projection changed', body[:1500])
        assert b'Matrix Calendar Widget public feed' not in body, ('app share marker leaked into native ICS feed', body[:1500])
        status, head_headers, head_body = request(port, 'HEAD', path)
        assert status == 200 and not head_body, ('anonymous token HEAD', status, len(head_body))
        assert int(head_headers['Content-Length']) == len(body), ('HEAD length', head_headers, len(body))
        propfind = b'''<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>'''
        status, _, props = request(port, 'PROPFIND', path, body=propfind, headers={'Depth': '0', 'Content-Type': 'application/xml; charset=utf-8'})
        assert status == 207 and b'<C:comp name="VEVENT"' in props and b'VTODO' not in props and b'VJOURNAL' not in props, ('anonymous token PROPFIND component metadata', status, props[:1000])

        # The read-only token must not let anonymous callers write or delete a VEVENT.
        status, _, _ = request(port, 'PUT', path + 'forbidden.ics', body=ics, headers={'Content-Type': 'text/calendar'})
        assert status not in {200, 201, 204}, ('anonymous token PUT unexpectedly succeeded', status)
        status, _, _ = request(port, 'DELETE', path + 'event.ics')
        assert status not in {200, 201, 204}, ('anonymous token DELETE unexpectedly succeeded', status)

        status, _, list_body = request(port, 'POST', '/.sharing/v1/token/list', body=json.dumps({'PathMapped': '/alice/team/'}).encode(), auth=owner, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status == 200, ('list shares', status, list_body[:500])
        listed = json.loads(list_body)
        assert listed.get('Status') == 'success' and len(listed.get('Content', [])) == 1, ('list result', listed)
        row = listed['Content'][0]
        assert row['PathOrToken'] == path and row['Permissions'] == 'r' and row['PathMapped'] == '/alice/team/' and row['Properties'] == {'D:displayname': 'Matrix Calendar Widget public feed'}, ('share row', row)

        status, _, _ = request(port, 'POST', '/.sharing/v1/token/create', body=create, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status in {401, 403}, ('anonymous share administration', status)
        unknown_token_path = '/.token/v1/' + ('A' * 44) + '/'
        status, _, _ = request(port, 'GET', unknown_token_path)
        assert status in {401, 403, 404}, ('unknown feed token should be unavailable', status)

        process.terminate()
        try:
            raw_log = process.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            process.kill()
            raw_log = process.communicate()[0]
        logs.append(raw_log)
        process = start_radicale(config, collections, port, userinfo_port)
        wait_ready(process, port)
        status, _, restored = request(port, 'GET', path)
        assert status == 200 and b'feed-contract-event' in restored and b'BEGIN:VTODO' not in restored and b'BEGIN:VJOURNAL' not in restored, ('share database restart persistence', status)

        delete = json.dumps({'PathOrToken': path}).encode()
        status, _, delete_body = request(port, 'POST', '/.sharing/v1/token/delete', body=delete, auth=owner, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status == 200, ('delete share', status, delete_body[:500])
        status, _, _ = request(port, 'GET', path)
        assert status in {401, 403, 404}, ('revoked feed remains accessible', status)

        # A second owner path proves the same Auth/owner_only model works for the appservice principal.
        bot = credential('calendarbot')
        status, _, _ = request(port, 'MKCALENDAR', '/calendarbot/room-team/', body=mkcalendar, auth=bot, headers={'Content-Type': 'application/xml; charset=utf-8'})
        assert status in {201, 207}, ('appservice-owner MKCALENDAR', status)
        status, _, _ = request(port, 'PUT', '/calendarbot/room-team/event.ics', body=ics, auth=bot, headers={'Content-Type': 'text/calendar'})
        assert status in {201, 204}, ('appservice-owner PUT', status)
        bot_create = json.dumps({'PathMapped': '/calendarbot/room-team/', 'Permissions': 'r', 'Conversion': 'none', 'Enabled': True, 'Hidden': False, 'Properties': {'D:displayname': 'Matrix Calendar Widget public feed'}}).encode()
        status, _, bot_body = request(port, 'POST', '/.sharing/v1/token/create', body=bot_create, auth=bot, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status == 200, ('appservice-owner share create', status, bot_body[:300])
        bot_path = json.loads(bot_body)['PathOrToken']
        status, _, bot_feed = request(port, 'GET', bot_path)
        assert status == 200 and b'feed-contract-event' in bot_feed, ('appservice-owner anonymous feed', status)

        # Radicale does not enforce the advertised component set on PUT. New
        # unsupported objects reach the token feed, so the gateway must scan
        # each bounded canonical VCALENDAR response before serving it.
        status, _, _ = request(port, 'MKCALENDAR', '/alice/mixed/', body=mkcalendar, auth=owner, headers={'Content-Type': 'application/xml; charset=utf-8'})
        assert status in {201, 207}, ('mixed-contract MKCALENDAR', status)
        status, _, _ = request(port, 'PUT', '/alice/mixed/event.ics', body=ics, auth=owner, headers={'Content-Type': 'text/calendar'})
        assert status in {201, 204}, ('mixed-contract VEVENT PUT', status)
        mixed_create = json.dumps({'PathMapped': '/alice/mixed/', 'Permissions': 'r', 'Conversion': 'none', 'Enabled': True, 'Hidden': False, 'Properties': {'D:displayname': 'Matrix Calendar Widget public feed'}}).encode()
        status, _, mixed_create_body = request(port, 'POST', '/.sharing/v1/token/create', body=mixed_create, auth=owner, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        assert status == 200, ('mixed-contract share create', status, mixed_create_body[:300])
        mixed_path = json.loads(mixed_create_body)['PathOrToken']
        status, _, initial_mixed = request(port, 'GET', mixed_path)
        assert status == 200 and b'BEGIN:VEVENT' in initial_mixed and b'BEGIN:VTODO' not in initial_mixed and b'BEGIN:VJOURNAL' not in initial_mixed, ('initial VEVENT-only token response', status, initial_mixed[:1500])
        todo = b'''BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:synthetic-task\r\nDTSTAMP:20261021T100000Z\r\nSUMMARY:Synthetic task\r\nEND:VTODO\r\nEND:VCALENDAR\r\n'''
        journal = b'''BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:synthetic-journal\r\nDTSTAMP:20261021T100000Z\r\nSUMMARY:Synthetic journal\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n'''
        for name, component in (('todo', todo), ('journal', journal)):
            status, _, _ = request(port, 'PUT', f'/alice/mixed/{name}.ics', body=component, auth=owner, headers={'Content-Type': 'text/calendar'})
            assert status in {201, 204}, ('synthetic unsupported component write', name, status)
        status, _, mixed = request(port, 'GET', mixed_path)
        assert status == 200 and b'BEGIN:VEVENT' in mixed and b'BEGIN:VTODO' in mixed and b'BEGIN:VJOURNAL' in mixed, ('native feed must expose newly added mixed components for gateway rejection', status, mixed[:1500])

        process.terminate()
        try:
            raw_log = process.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            process.kill()
            raw_log = process.communicate()[0]
        logs.append(raw_log)
        combined = '\n'.join(logs)
        path_token = path.rsplit('/', 2)[-2]
        bot_token = bot_path.rsplit('/', 2)[-2]
        unknown_token = unknown_token_path.rsplit('/', 2)[-2]
        mixed_token = mixed_path.rsplit('/', 2)[-2]
        for secret in (path, bot_path, mixed_path, path_token, bot_token, mixed_token, unknown_token_path, unknown_token):
            assert secret not in combined, ('token appeared in Radicale logs, including successful or failed native requests', combined[-4000:])
        assert '[REDACTED]' in combined, ('trace logging did not exercise token-path redaction', combined[-2000:])
        share_dir = collections / 'collection-db' / 'files' / 'token'
        assert share_dir.is_dir(), ('sharing store missing below canonical collection tree', share_dir)
        print(json.dumps({'status': 'passed', 'radicale_version': radicale.VERSION, 'project_config_native_sharing': 'passed', 'rights': 'owner_only unchanged', 'native_token_prefix': '/.token/v1/', 'token_chars': 44, 'permissions': 'r', 'conversion': 'none', 'anonymous_get_head': 'passed', 'anonymous_propfind_component_metadata': 'passed', 'unsupported_components_returned_by_radicale': ['VTODO', 'VJOURNAL'], 'admin_requires_auth': 'passed', 'database_restart_persistence': 'passed', 'revocation': 'passed', 'personal_owner': 'alice', 'room_service_owner': 'calendarbot', 'canonical_fields': ['VEVENT', 'Europe/Stockholm VTIMEZONE', 'RRULE', 'opaque X property'], 'native_collection_displayname_projection': 'X-WR-CALNAME present; exact external metadata shape must not be promised', 'sharing_store_relative_path': 'collection-db/files/token', 'share_token_redacted_at_radicale_logging_level_trace': 'passed for successful, failed, and revoked requests'}))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        userinfo.shutdown()
        userinfo.server_close()
