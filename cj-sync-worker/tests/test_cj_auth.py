import io
import json
import urllib.error
import unittest
from unittest import mock

import cj_auth


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def http_error(code: int, body: bytes = b"Bad Gateway") -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://example.test/order/list",
        code,
        "failure",
        {},
        io.BytesIO(body),
    )


class CjAuthRequestTests(unittest.TestCase):
    def test_get_retries_transient_502_then_returns_json(self) -> None:
        with mock.patch.object(
            cj_auth.urllib.request,
            "urlopen",
            side_effect=[http_error(502), FakeResponse({"result": True})],
        ) as urlopen, mock.patch.object(cj_auth.time, "sleep") as sleep, mock.patch.object(
            cj_auth.random, "uniform", return_value=0.1
        ):
            result = cj_auth.request_json(
                "GET", "https://example.test/order/list", {"Authorization": "redacted"}
            )

        self.assertEqual(result, {"result": True})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once()

    def test_post_does_not_retry_uncertain_502(self) -> None:
        with mock.patch.object(
            cj_auth.urllib.request,
            "urlopen",
            side_effect=http_error(502),
        ) as urlopen, mock.patch.object(cj_auth.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "HTTP 502"):
                cj_auth.request_json(
                    "POST",
                    "https://example.test/order/create",
                    {"Authorization": "redacted"},
                    {"order": "test"},
                )

        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
