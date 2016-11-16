'use strict';

var path = require('path');
var gulp = require('gulp');
var request = require('request')
var progress = require('request-progress')
var source = require('vinyl-source-stream')
var jetpack = require('fs-jetpack');
var conf = require('./conf');
var utils = require('./utils');
var _ = require('lodash');
var os = require('os');
var decompress = require('gulp-decompress');
var clean = require('gulp-clean');
var merge = require('merge-stream');


var $ = require('gulp-load-plugins')({
  pattern: ['gulp-*', 'main-bower-files', 'uglify-save-license', 'del', 'lazypipe', 'streamify']
});

gulp.task('background', ['scripts'], function () {
  gulp.src(path.join(conf.paths.tmp, '/serve/app/background.js'))
    .pipe($.uglify()).on('error', conf.errorHandler('Uglify background.js'))
    .pipe(gulp.dest(path.join(conf.paths.dist, '/')));
});

gulp.task('html', ['background', 'inject', 'partials'], function () {
  var htmlFilter = $.filter('*.html', {restore: true});
  var jsFilter = $.filter('**/*.js', {restore: true});
  var cssFilter = $.filter('**/*.css', {restore: true});

  return gulp.src(path.join(conf.paths.tmp, '/serve/*.html'))
    .pipe($.useref({}, $.lazypipe().pipe($.sourcemaps.init, {loadMaps: true})))
    .pipe(jsFilter)
    .pipe($.ngAnnotate())
    .pipe($.rev())
    .pipe($.uglify({preserveComments: $.uglifySaveLicense})).on('error', conf.errorHandler('Uglify'))
    .pipe($.sourcemaps.write('maps'))
    .pipe(jsFilter.restore)
    .pipe(cssFilter)
    .pipe($.replace('../../bower_components/bootstrap-sass/assets/fonts/bootstrap/', '../fonts/'))
    .pipe($.replace(/url\('ui-grid.(.+?)'\)/g, 'url(\'../fonts/ui-grid.$1\')'))
    .pipe($.rev())
    .pipe($.csso())
    .pipe($.sourcemaps.write('maps'))
    .pipe(cssFilter.restore)
    .pipe($.revReplace())
    .pipe(htmlFilter)
    .pipe($.htmlmin({
      collapseBooleanAttributes: true,
      collapseInlineTagWhitespace: true,
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeTagWhitespace: true
    }))
    .pipe(htmlFilter.restore)
    .pipe(gulp.dest(path.join(conf.paths.dist, '/')))
    .pipe($.size({
      title: path.join(conf.paths.dist, '/'),
      showFiles: true
    }));
});

// Only applies for fonts from bower dependencies
// Custom fonts are handled by the "other" task
gulp.task('fonts', function () {
  return gulp.src($.mainBowerFiles())
    .pipe($.filter('**/*.{eot,svg,ttf,woff,woff2}'))
    .pipe($.flatten())
    .pipe(gulp.dest(path.join(conf.paths.dist, '/fonts/')));
});

gulp.task('other', function () {
  return gulp.src([
    path.join(conf.paths.src, '/**/*'),
    path.join('!' + conf.paths.src, '/node_modules/**/*'),
    path.join('!' + conf.paths.src, '/**/*.{html,css,js,scss}')
  ])
    .pipe($.filter(file => file.stat.isFile()))
    .pipe(gulp.dest(path.join(conf.paths.dist, '/')));
});

gulp.task('nodeModules', function () {
  return gulp.src(path.join(conf.paths.src, '/node_modules/**/*'), {base: conf.paths.src})
    .pipe($.filter(file => file.stat.isFile()))
    .pipe(gulp.dest(path.join(conf.paths.dist, '/')));
});

gulp.task('clean', function () {
  return $.del([path.join(conf.paths.dist, '/'), path.join(conf.paths.tmp, '/')]);
});

gulp.task('build', ['html', 'fonts', 'nodeModules', 'other', 'environment'], function () {
  // Finalize
  var manifest = jetpack.read(path.join(__dirname, '..', conf.paths.src, 'package.json'), 'json');

  // Add "dev" or "test" suffix to name, so Electron will write all data
  // like cookies and localStorage in separate places for each environment.
  switch (utils.getEnvName()) {
    case 'development':
      manifest.name += '-dev';
      manifest.productName += 'Dev';
      break;
    case 'test':
      manifest.name += '-test';
      manifest.productName += 'Test';
      break;
  }

  jetpack.write(path.join(__dirname, '..', conf.paths.dist, 'package.json'), manifest);
});

gulp.task('environment', function () {
  var configFile = 'config/env_' + utils.getEnvName() + '.json';
  jetpack.copy(configFile, path.join(conf.paths.dist, '/env.json'), {overwrite: true});
});

gulp.task('manifest', function() {
  jetpack.copy('manifest.json', path.join(conf.paths.dist, '/manifest.json'), {overwrite: true});
});

// Binary dependency management

var argv = require('yargs').argv;

let destination = path.join(conf.paths.dist, '..', 'depend');
let dependencies = ['ruby','mongo','openstudioServer','openstudio'];

if( argv.prefix ) {
  destination = argv.prefix;
}

if( argv.exclude ) {
  const without = argv.exclude.split(',');
  dependencies = _.difference(dependencies, without);
}

const manifest = jetpack.read('manifest.json', 'json');

const platform = os.platform();
const arch = os.arch();

gulp.task('download-deps', function() {

  // List the dependencies to download here
  // These should correspond to keys in the manifest

  var tasks = dependencies.map( depend => {
    const fileInfo = _.find(manifest[depend], {platform: platform});
    const fileName = fileInfo.name;

    return progress(request({uri: manifest.endpoint + fileName, timeout: 5000}))
      .on('progress', state => {
        console.log(`Downloading ${depend}, ${(state.percentage * 100).toFixed(0)}%`)
      })
      .pipe(source(fileName))
      .pipe(gulp.dest(destination));
  });

  return merge(tasks);
});

gulp.task('extract-deps',['download-deps'], function() {
  var tasks = dependencies.map( depend => {
    const fileInfo = _.find(manifest[depend], {platform: platform});
    const fileName = fileInfo.name;

    return gulp.src(path.join(destination, fileName))
      .pipe( decompress() )
      .pipe(gulp.dest(destination));
  });

  return merge(tasks);
});

gulp.task('remove-deps-tar', ['extract-deps'], function() {
  var tasks = dependencies.map( depend => {
    const fileInfo = _.find(manifest[depend], {platform: platform});
    const fileName = fileInfo.name;

    return gulp.src(path.join(destination, fileName), {read: false})
      .pipe( clean() );
  });

  return merge(tasks);
});

gulp.task('install-deps',['remove-deps-tar'], function() {
});




