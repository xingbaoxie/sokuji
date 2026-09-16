#!/usr/bin/env python3
"""Print an scrypt hash suitable for SOKUJI_TEST_CONFIG_PASSWORD_HASH."""

import base64
import getpass
import hashlib
import secrets


password = getpass.getpass("Shared test password: ")
if not password:
    raise SystemExit("Password cannot be empty.")
salt = secrets.token_bytes(16)
n, r, p = 16384, 8, 1
derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii")
print(f"scrypt${n}${r}${p}${encode(salt)}${encode(derived)}")
