import base64
from io import BytesIO

import pytest
from PIL import Image

from kairos.application.image_input import ImageValidationError, validate_image


def _png(width: int = 40, height: int = 20, exif: bool = False, fmt: str = "PNG") -> str:
    image = Image.new("RGB", (width, height), (200, 100, 50))
    out = BytesIO()
    if exif:
        data = Image.Exif()
        data[0x010F] = "SecretCam"
        image.save(out, format=fmt, exif=data)
    else:
        image.save(out, format=fmt)
    return base64.b64encode(out.getvalue()).decode()


def test_valid_png_is_normalized() -> None:
    result = validate_image("image/png", _png())
    assert (result.width, result.height) == (40, 20)
    assert result.data_url.startswith("data:image/png;base64,")
    assert len(result.sha256) == 64


def test_exif_is_dropped() -> None:
    result = validate_image("image/jpeg", _png(exif=True, fmt="JPEG"))
    raw = base64.b64decode(result.data_url.split(",", 1)[1])
    assert b"SecretCam" not in raw


@pytest.mark.parametrize(("mime", "payload"), [
    ("image/gif", _png()),
    ("image/jpeg", _png()),
    ("image/png", "not base64!!"),
    ("image/png", ""),
    ("image/png", base64.b64encode(b"hello").decode()),
])
def test_rejects_bad_input(mime: str, payload: str) -> None:
    with pytest.raises(ImageValidationError):
        validate_image(mime, payload)


def test_large_image_is_downscaled() -> None:
    result = validate_image("image/png", _png(4000, 2500))
    assert result.width * result.height <= 8_388_608
