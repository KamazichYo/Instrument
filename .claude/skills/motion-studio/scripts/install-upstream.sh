#!/usr/bin/env bash
# Установка лучших сторонних паков моушн-графики рядом с Motion Studio.
#   bash install-upstream.sh --list
#   bash install-upstream.sh hyperframes remotion bart        выбранные
#   bash install-upstream.sh recommended                      hyperframes + remotion + bart + motionmaxxing + lottie
#   bash install-upstream.sh all
#   bash install-upstream.sh --global bart                    в ~/.claude/skills (для всех проектов)
#   bash install-upstream.sh --remove                         удалить установленные (up-*)
# Паки ставятся как .claude/skills/up-<пак>-<скилл>/ (в git не попадают — см. .gitignore).
# Лицензии у паков свои (см. references/upstream.md) — проверь перед коммерческим использованием.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT_SKILLS="$(cd "$HERE/../.." && pwd)"      # .claude/skills
DEST="$PROJECT_SKILLS"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/motion-studio/upstream"

declare -A REPO=(
  [hyperframes]="heygen-com/hyperframes|skills"
  [remotion]="remotion-dev/skills|skills"
  [bart]="Barty-Bart/motion-graphics|skills"
  [motionmaxxing]="Tejashmakwana/motionmaxxing|."
  [charlie]="charlie947/motion-graphics-skills|skills"
  [lottie]="LottieFiles/motion-design-skill|skills"
  [shotcraft]="Vincentwei1021/video-shotcraft|."
  [talkcraft]="Vincentwei1021/video-talkcraft|."
  [explainer]="Vincentwei1021/anything2explainer|."
  [howseen]="howseen-ai/claude-motion-design|skill"
  [iart]="iart-ai/motion-skills|."
  [motionprinciples]="kylezantos/design-motion-principles|."
  [herk]="nateherkai/herk-edit-kit|."
)
declare -A ABOUT=(
  [hyperframes]="HeyGen HyperFrames (77k★, Apache-2.0): HTML→видео, 450 блоков, реверс любого видео, Figma"
  [remotion]="Remotion official (6k★, Remotion License): React-видео, субтитры, рендер"
  [bart]="Bart Slodyczka (1k★, MIT): motion-broll к говорящей голове, explainers, SAM2-вырезка, звук"
  [motionmaxxing]="motionmaxxing (1.2k★, Apache-2.0): режиссура «не нейрослоп», замеры 53 роликов, гейты"
  [charlie]="Charlie Hills (MIT): 15 скиллов — лаунч, Vox-эксплейнер, 3D-титры, графики, reel-export"
  [lottie]="LottieFiles (2.7k★, MIT): универсальные принципы моушн-дизайна"
  [shotcraft]="video-shotcraft (16k★, Apache-2.0): кинематографичные промо на Remotion, 124 карточки шотов"
  [talkcraft]="video-talkcraft (2k★): эксплейнеры под голос"
  [explainer]="anything2explainer (3k★): тема → эксплейнер с голосом"
  [howseen]="Howseen (MIT): HTML+Playwright+ffmpeg пайплайн, ремейк видео по референсу"
  [iart]="iart.ai (1.1k★, MIT): 50 скиллов — кинетика, дата-виз, переходы"
  [motionprinciples]="design-motion-principles (1.5k★, MIT): моушн для UI-компонентов + аудит"
  [herk]="Herk Edit Kit (2.5k★): монтаж Reels/Shorts — транскрипт, нарезка, 15 скиллов"
)
RECOMMENDED="hyperframes remotion bart motionmaxxing lottie"

list() { echo "Паки:"; for k in $(echo "${!REPO[@]}" | tr ' ' '\n' | sort); do printf "  %-17s %s\n" "$k" "${ABOUT[$k]}"; done; echo; echo "  recommended = $RECOMMENDED"; }

args=()
for a in "$@"; do
  case "$a" in
    --list|-l) list; exit 0;;
    --global) DEST="$HOME/.claude/skills";;
    --remove) rm -rf "$DEST"/up-*; echo "✔ удалены up-* из $DEST"; exit 0;;
    recommended) args+=($RECOMMENDED);;
    all) args+=("${!REPO[@]}");;
    *) args+=("$a");;
  esac
done
[ ${#args[@]} -eq 0 ] && { list; exit 1; }
mkdir -p "$CACHE" "$DEST"

for name in "${args[@]}"; do
  spec="${REPO[$name]}"; [ -z "$spec" ] && { echo "✖ нет пака «$name» (--list)"; continue; }
  repo="${spec%%|*}"; sub="${spec##*|}"
  dir="$CACHE/${repo//\//_}"
  if [ -d "$dir/.git" ]; then git -C "$dir" pull -q --depth 1 2>/dev/null || true
  else echo "… $repo"; git clone -q --depth 1 --filter=blob:limit=20m "https://github.com/$repo.git" "$dir"; fi
  n=0; root="$dir"; [ "$sub" != "." ] && root="$dir/$sub"
  while IFS= read -r skill; do
    sdir="$(dirname "$skill")"; sname="$(basename "$sdir")"
    [ "$sdir" = "$dir" ] && sname="$name"
    target="$DEST/up-$name-$sname"; [ "$sname" = "$name" ] && target="$DEST/up-$name"
    rm -rf "$target"; mkdir -p "$target"
    (cd "$sdir" && tar --exclude=node_modules --exclude=.git -cf - .) | (cd "$target" && tar -xf -)
    # name: в SKILL.md не трогаем — паки ссылаются на свои скиллы по имени (роутеры Remotion/HyperFrames)
    [ -f "$dir/LICENSE" ] && [ ! -f "$target/LICENSE" ] && cp "$dir/LICENSE" "$target/LICENSE"
    n=$((n+1))
  done < <(find "$root" -maxdepth 3 -name SKILL.md -not -path '*/node_modules/*' -not -path '*/tests/*' -not -path '*/registry/*' -not -path '*/.agents/*' -not -path '*/.claude/*' -not -path '*/examples/*' -not -path '*/fixtures/*' | sort)
  echo "✔ $name: $n скилл(ов) → $DEST/up-$name*"
done
echo "Перезапусти Claude Code (или открой новую сессию), чтобы скиллы подхватились."
