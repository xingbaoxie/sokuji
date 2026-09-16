import base64
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from test_config import FailedLoginLimiter, load_test_config, verify_scrypt_password


def scrypt_hash(password: str) -> str:
    salt = b"test-salt-123456"
    derived = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii")
    return f"scrypt$16384$8$1${encode(salt)}${encode(derived)}"


class TestConfigTests(unittest.TestCase):
    def test_verifies_scrypt_hash_without_accepting_malformed_values(self):
        encoded = scrypt_hash("correct horse battery staple")
        self.assertTrue(verify_scrypt_password("correct horse battery staple", encoded))
        self.assertFalse(verify_scrypt_password("incorrect", encoded))
        self.assertFalse(verify_scrypt_password("incorrect", "scrypt$not-a-number"))

    def test_example_config_is_complete_and_secret_free(self):
        source = Path(__file__).with_name("test-config.example.json")
        value = json.loads(source.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            config_file = Path(directory) / "test-config.json"
            config_file.write_text(json.dumps(value), encoding="utf-8")
            self.assertEqual(load_test_config(config_file)["revision"], "test-YYYYMMDD-01")
        self.assertNotIn("sk-ws-", source.read_text(encoding="utf-8"))

    def test_limiter_blocks_after_five_failures_and_clears_after_success(self):
        limiter = FailedLoginLimiter(max_failures=5, window_seconds=60)
        for _ in range(5):
            limiter.failure("127.0.0.1")
        self.assertTrue(limiter.blocked("127.0.0.1"))
        limiter.success("127.0.0.1")
        self.assertFalse(limiter.blocked("127.0.0.1"))

    def test_limiter_expires_old_failures(self):
        limiter = FailedLoginLimiter(max_failures=1, window_seconds=10)
        with patch("test_config.time.monotonic", side_effect=[100, 111]):
            limiter.failure("client")
            self.assertFalse(limiter.blocked("client"))


if __name__ == "__main__":
    unittest.main()
