# PATH=$PATH:./node_modules/.bin
# which browserify > /dev/null || (echo "can not find browserify" && false) || exit

SRC_DIR=${SRC_DIR:-'.'}
echo SRC_DIR=$SRC_DIR

BUILD_DIR=${BUILD_DIR:='build_temp'}
echo BUILD_DIR=$BUILD_DIR

# Build the main file
# npx browserify "./$COMPILE_DIR/main_background.js" -o "./$BUILD_DIR/bundle.js"
npx browserify "./$SRC_DIR/main_background.js" -o "./$BUILD_DIR/bundle.js"

# build zip file from temp directory
cd "./$BUILD_DIR"
zip -r librejs.zip *
# remove old file
rm ../librejs.xpi || true
# move new zip file
mv librejs.zip ../

# go back to source dir
cd ../
# change the zip file to a xpi file that can be uploaded
mv librejs.zip librejs.xpi
