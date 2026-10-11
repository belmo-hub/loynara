"""One compiled local system rehearsal; no deployment or production acceptance.
Requires existing owned PostgreSQL55433 and prebuilt Next/website artifacts.
Uses the supported preview pattern: compiled local web, development worker.
"""
import os, pathlib, signal, socket, subprocess, tempfile, time, urllib.request, uuid

if not __debug__:
    raise RuntimeError('Optimized Python is forbidden: ownership guards must execute before any database access')

ROOT = pathlib.Path(__file__).resolve().parents[1]
DSN = 'postgresql://looplocal:looplocal_local_only@localhost:55433/'
NAME = 'looplocal_rehearsal_' + uuid.uuid4().hex[:12]
ENV = {k: os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'SHELL'] if k in os.environ}
ENV.update(DATABASE_URL=DSN + NAME, BETTER_AUTH_SECRET='synthetic-rehearsal-local-only-secret-110', BETTER_AUTH_URL='http://localhost:3000', PUBLIC_BASE_URL='http://localhost:3000', PUBLIC_REGISTRATION_ENABLED='false', STAFF_INVITE_SIGNUP_ENABLED='false', TRUST_PROXY_CLIENT_IP='false', EXTERNAL_EMAIL_ENABLED='false', PROMOTIONAL_EXTERNAL_EMAIL_ENABLED='false', MAILGUN_PROMOTIONAL_SEND_APPROVED='false', PASSFAST_ENABLED='false', GOOGLE_WALLET_ENABLED='false', APPLE_WALLET_ENABLED='false', GOOGLE_WALLET_ASSET_ENABLED='false', LIVE_BILLING_ENABLED='false', NEXT_TELEMETRY_DISABLED='1', DOTENV_CONFIG_PATH='/tmp/loynara-no-dotenv-rehearsal-110', NODE_ENV='development')

def run(args, **kw):
    return subprocess.run(args, cwd=ROOT, env=ENV, check=True, **kw)

def query(db, sql):
    return subprocess.check_output(['psql', DSN + db, '-Atc', sql], env=ENV, text=True).strip()

assert query('postgres', 'SHOW data_directory') == '/private/tmp/loynara-goal-133-pg'
assert query('postgres', "SELECT count(*) FROM pg_database WHERE datname='" + NAME + "'") == '0'
for port in [3000, 8795]:
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1', port)) != 0, f'Port {port} is occupied; do not stop other processes'
assert (ROOT / '.next/BUILD_ID').is_file(), 'Build application first'
assert (ROOT / 'marketing-site/site/assets/app.js').is_file(), 'Build reviewed website first'
processes, logs = [], []
created = False

def stop():
    for p in processes:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
    for p in processes:
        p.wait(timeout=30)  # Never force-kill a hung service.
    processes.clear()
    for log in logs:
        log.close()
    logs.clear()

def start(folder, generation):
    commands = [('web', ['./node_modules/.bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000']), ('website', ['node', 'marketing-site/preview.mjs']), ('worker', ['./node_modules/.bin/tsx', 'scripts/worker.ts'])]
    for label, args in commands:
        env = dict(ENV, NODE_ENV='production' if label == 'web' else 'development', PORT='8795')
        log = open(folder / f'{generation}-{label}.log', 'w')
        logs.append(log)
        processes.append(subprocess.Popen(args, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT))
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        assert all(p.poll() is None for p in processes), 'Owned service exited before ready; inspect sanitized logs'
        try:
            for url in ['http://localhost:3000/login', 'http://127.0.0.1:8795/']:
                with urllib.request.urlopen(url, timeout=2) as response:
                    assert response.status == 200
            return
        except (OSError, AssertionError):
            time.sleep(0.5)
    raise RuntimeError('Local services readiness timeout')

with tempfile.TemporaryDirectory(prefix='loy-110-', dir='/tmp') as private:
    folder = pathlib.Path(private)
    os.chmod(folder, 0o700)
    ENV.update(REHEARSAL_FIXTURE=str(folder / 'fixture.json'), REHEARSAL_DIRECTORY=private)
    try:
        run(['psql', DSN + 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE ' + NAME], stdout=subprocess.DEVNULL)
        created = True
        run(['psql', DSN + NAME, '-v', 'ON_ERROR_STOP=1', '-f', 'drizzle/auth.sql'], stdout=subprocess.DEVNULL)
        run(['./node_modules/.bin/drizzle-kit', 'migrate'])
        assert query(NAME, 'SELECT count(*) FROM drizzle.__drizzle_migrations') == '25'
        ENV['PUBLIC_REGISTRATION_ENABLED'] = 'true'  # Direct synthetic identity provisioning only, never running web signup.
        run(['./node_modules/.bin/tsx', 'scripts/full-stack-release-fixture.ts', 'identities'])
        ENV['PUBLIC_REGISTRATION_ENABLED'] = 'false'
        start(folder, 'before')
        run(['./node_modules/.bin/tsx', 'scripts/full-stack-release-fixture.ts', 'onboard'])
        ENV['REHEARSAL_PHASE'] = 'before'
        run(['./node_modules/.bin/playwright', 'test', 'e2e/full-stack-release.spec.ts'])
        assert all(p.poll() is None for p in processes), 'All three owned services must be alive before restart'
        first_pids = [p.pid for p in processes]
        stop()
        start(folder, 'after')
        assert not set(first_pids).intersection(p.pid for p in processes)
        ENV['REHEARSAL_PHASE'] = 'after'
        run(['./node_modules/.bin/playwright', 'test', 'e2e/full-stack-release.spec.ts'])
        assert all(p.poll() is None for p in processes), 'All three restarted services must remain alive'
        print('PASS: compiled web/static website/actual providers-OFF worker restarted with new PIDs; browser sessions and authoritative accounting durable; no hosted/provider acceptance')
    finally:
        stop()
        if created:
            assert query('postgres', "SELECT count(*) FROM pg_stat_activity WHERE datname='" + NAME + "'") == '0'
            run(['psql', DSN + 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP DATABASE ' + NAME], stdout=subprocess.DEVNULL)
