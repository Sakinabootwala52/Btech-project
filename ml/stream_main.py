import argparse

from stream_processor import StreamProcessor


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--source",
        required=True,
        help="Video path or camera index",
    )

    parser.add_argument(
        "--camera-id",
        default="CAM_001",
    )

    parser.add_argument(
        "--inference-stride",
        type=int,
        default=2,
    )

    args = parser.parse_args()

    source = args.source

    # Allow webcam index such as "0"
    if source.isdigit():
        source = int(source)

    processor = StreamProcessor(
        camera_id=args.camera_id,
        inference_stride=args.inference_stride,
    )

    processor.process_stream(source)


if __name__ == "__main__":
    main()