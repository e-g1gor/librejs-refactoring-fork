# prepare / update testing environment if needed
SRC_DIR=${SRC_DIR:-'./webextension'}
echo SRC_DIR=$SRC_DIR

JASMINE_VER=3.2.1
echo JASMINE_VER=$JASMINE_VER

JASMINE_LIB="$SRC_DIR/test/lib/jasmine-$JASMINE_VER"
echo JASMINE_LIB=$JASMINE_LIB

if ! [ -d "$JASMINE_LIB" ]; then
  mkdir -p $SRC_DIR/test/lib
  rm -rf $SRC_DIR/test/lib/jasmine-*
  JASMINE_URL="https://github.com/jasmine/jasmine/releases/download/v$JASMINE_VER/jasmine-standalone-$JASMINE_VER.zip"
  curl -L -o "$JASMINE_LIB.zip" "$JASMINE_URL" && unzip -d "$SRC_DIR/test/" $JASMINE_LIB.zip lib/**
  rm -f "$JASMINE_LIB.zip"
fi
