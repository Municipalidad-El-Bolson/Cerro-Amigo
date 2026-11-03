"""Prueba local opcional. Python estándar + Firefox con Marionette; sin paquetes externos."""
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

class Marionette:
    def __init__(self, port):
        self.sock = socket.create_connection(('127.0.0.1', port), timeout=20)
        self.sequence = 0
        self.receive()
    def receive(self):
        prefix = b''
        while not prefix.endswith(b':'):
            part = self.sock.recv(1)
            if not part:
                raise RuntimeError('Firefox cerró la conexión')
            prefix += part
        size = int(prefix[:-1])
        raw = b''
        while len(raw) < size:
            part = self.sock.recv(size - len(raw))
            if not part:
                raise RuntimeError('Respuesta incompleta')
            raw += part
        return json.loads(raw)
    def call(self, command, params=None):
        self.sequence += 1
        raw = json.dumps([0, self.sequence, command, params or {}]).encode()
        self.sock.sendall(str(len(raw)).encode() + b':' + raw)
        result = self.receive()
        if result[2]:
            raise RuntimeError(str(result[2]))
        return result[3]
    def js(self, code):
        return self.call('WebDriver:ExecuteScript', {'script': code, 'args': [], 'newSandbox': True, 'sandbox': 'default'})['value']
    def wait(self, code):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.js(code):
                return
            time.sleep(.15)
        raise AssertionError('No se cumplió la condición UI: ' + code)

# Home dir works with Firefox packaged as snap, which isolates /tmp.
profile_root = Path.home()/'snap'/'firefox'/'common'
if not profile_root.is_dir():
    profile_root = Path.home()
base = Path(tempfile.mkdtemp(prefix='cerro-amigo-ui-', dir=profile_root))
port, marionette_port = free_port(), free_port()
password = secrets.token_urlsafe(24)
env = {**os.environ, 'DB_PATH': str(base/'test.sqlite'), 'PORT': str(port), 'APP_ORIGIN': f'http://127.0.0.1:{port}'}
server = firefox = driver = None
try:
    result = subprocess.run(['node','scripts/admin.js','prueba_ui'], input=password+'\n', text=True, env=env, capture_output=True, check=True)
    log = open(base/'process.log', 'w')
    server = subprocess.Popen(['node','server.js'], env=env, stdout=log, stderr=log)
    profile = base/'firefox'
    profile.mkdir()
    (profile/'user.js').write_text('user_pref("marionette.port", %d);\nuser_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\n' % marionette_port)
    firefox = subprocess.Popen(['firefox','--headless','--no-remote','--profile',str(profile),'--marionette','about:blank'], stdout=log, stderr=log)
    deadline = time.monotonic()+30
    while time.monotonic()<deadline:
        try:
            driver=Marionette(marionette_port)
            break
        except (ConnectionError,OSError):
            if firefox.poll() is not None:
                raise RuntimeError('Firefox no pudo iniciarse: '+(base/'process.log').read_text()[-1500:])
            time.sleep(.25)
    if not driver:
        raise RuntimeError('Marionette no estuvo disponible en 30 segundos')
    driver.call('WebDriver:NewSession', {'capabilities': {'alwaysMatch': {'acceptInsecureCerts': False}}})
    driver.call('WebDriver:SetWindowRect', {'width':1024,'height':1000})
    driver.call('WebDriver:Navigate', {'url':env['APP_ORIGIN']})
    driver.wait("return !!document.querySelector('#login-form')")
    driver.js("document.querySelector('[name=username]').value='prueba_ui';document.querySelector('[name=password]').value="+json.dumps(password)+";document.querySelector('#login-form').requestSubmit();return true")
    driver.wait("return !document.querySelector('#workspace').hidden && !!document.querySelector('#counters input')")
    driver.js("document.querySelector('[data-tab=admin]').click();return true")
    driver.wait("return !document.querySelector('#admin').hidden && document.querySelector('#users').children.length>0")
    driver.js("const f=document.querySelector('#tariff-form');f.elements.adult.value='1000';f.elements.child.value='500';f.elements.senior.value='250';f.elements.reason.value='Tarifas sintéticas para prueba UI';f.requestSubmit();return true")
    driver.wait("return document.querySelector('#notice').textContent.includes('Tarifas guardadas')")
    driver.js("document.querySelector('[data-tab=register]').click();return true")
    driver.wait("return !document.querySelector('#register').hidden")
    assert driver.js("return document.documentElement.scrollWidth<=window.innerWidth"), 'Desborde en tablet'
    screenshot=driver.call('WebDriver:TakeScreenshot', {'id':None,'highlights':[],'full':True})['value']
    (ROOT/'docs'/'captura-tablet.png').write_bytes(base64.b64decode(screenshot))
    driver.js("const f=document.querySelector('#visit-form');f.elements.name.value='VISITA SINTÉTICA';f.elements.locality.value='El Bolsón';f.elements.adult.value=2;f.elements.child.value=1;f.elements.senior.value=1;f.requestSubmit();return true")
    driver.wait("return document.querySelector('#detail').open")
    assert driver.js("return document.querySelector('#detail-content').textContent.includes('VISITA SINTÉTICA')"), 'Falta detalle'
    assert driver.js("return document.querySelector('#detail-content').textContent.includes('Pago pendiente')"), 'Pago no pendiente'
    driver.js("document.querySelector('#cash').click();return true")
    driver.call('WebDriver:AcceptAlert')
    driver.wait("return document.querySelector('#detail-content').textContent.includes('Efectivo confirmado')")
    driver.js("document.querySelector('#close-detail').click();document.querySelector('[data-tab=history]').click();return true")
    driver.wait("return document.querySelector('#visit-list').textContent.includes('VISITA SINTÉTICA')")
    driver.js("document.querySelector('[data-tab=dashboard]').click();return true")
    driver.wait("return document.querySelector('#stats').textContent.includes('Cobrado')")
    driver.call('WebDriver:SetWindowRect', {'width':390,'height':844})
    driver.js("document.querySelector('[data-tab=register]').click();return true")
    assert driver.js("return document.documentElement.scrollWidth<=window.innerWidth"), 'Desborde móvil'
    # Disconnect the backend, keep the existing authenticated page and tariff snapshot.
    server.terminate();server.wait(timeout=10);server=None
    driver.js("const f=document.querySelector('#visit-form');f.elements.name.value='PENDIENTE SINTÉTICO';f.elements.locality.value='Lago Puelo';f.requestSubmit();return true")
    driver.wait("return !document.querySelector('#save-visit').disabled && document.querySelector('#queue-count').textContent==='1'")
    driver.js("document.querySelector('[data-tab=queue]').click();return true")
    assert driver.js("return document.querySelector('#queue-list').textContent.includes('PENDIENTE SINTÉTICO')"), 'No se conservó pendiente'
    server=subprocess.Popen(['node','server.js'],env=env,stdout=log,stderr=log)
    for _ in range(50):
        try:
            urllib.request.urlopen(env['APP_ORIGIN'],timeout=1).close();break
        except OSError:
            time.sleep(.1)
    driver.js("document.querySelector('#sync').click();return true")
    driver.wait("return document.querySelector('#queue-count').textContent==='0'")
    driver.js("document.querySelector('[data-tab=history]').click();return true")
    driver.wait("return document.querySelector('#visit-list').textContent.includes('PENDIENTE SINTÉTICO')")
    assert driver.js("return document.querySelectorAll('[data-visit]').length===2"), 'Cantidad inesperada de registros'
    print('UI OK: login, tarifas, registro, efectivo, historial, estadísticas, anchos 1024/390, corte real de servidor y sincronización. Captura: docs/captura-tablet.png')
finally:
    if driver:
        try:
            driver.call('WebDriver:DeleteSession')
            driver.sock.close()
        except Exception:
            pass
    for process in (firefox,server):
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill();process.wait()
    shutil.rmtree(base)
