#!/usr/bin/env bash
# Split an MP4 into fixed-length segments without re-encoding.
#
# Usage: ./split-mp4.sh <input.mp4> [segment-seconds]
#
# Segment boundaries snap to the nearest preceding keyframe, so parts are only
# exactly <segment-seconds> long when the source has a keyframe there. The
# script reports the real duration of each part so drift is visible.

set -euo pipefail

input=${1:?usage: split-mp4.sh <input.mp4> [segment-seconds]}
segment_seconds=${2:-10}

if [ ! -f "$input" ]; then
  echo "split-mp4: no such file: $input" >&2
  exit 1
fi

directory=$(dirname "$input")
base=$(basename "$input")
stem=${base%.*}
extension=${base##*.}

ffmpeg -y -v error \
  -i "$input" \
  -c copy -map 0 \
  -f segment -segment_time "$segment_seconds" \
  -reset_timestamps 1 -segment_start_number 1 \
  "$directory/${stem}_part%d.$extension"

for part in "$directory/${stem}"_part*."$extension"; do
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$part")
  printf '%s  %ss\n' "$part" "$duration"
done
