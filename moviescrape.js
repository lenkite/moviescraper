#!/usr/bin/env node --harmony

'use strict';

const
    fs = require('fs'),
    util = require('util'),
    cheerio = require('cheerio'),
    moment = require('moment'),
    qrystr = require('querystring'),
    jf = require('jsonfile'),
    Q = require('q');


const argv = require('minimist')(process.argv); //Fix me
const proxy = argv['proxy'];
if (proxy) {
    console.log("Proxy is: " + proxy);
} else {
    console.log("No proxy argument --proxy passed. Assumes direct connection");
}
const request = proxy ? require('request').defaults({'proxy': proxy}) : require('request');


/**
 * Construct a movie.
 * @param title movie title
 * @constructor
 */
function Movie(title, description, releaseDate) {
    const me = this;
    me.title = title;
    me.description = description || "";
    if (releaseDate && !releaseDate instanceof Date) {
        throw "release date should be js date";
    }
    me.releaseDate = releaseDate || null;
    me.productionHouses = [];
    me.starCast = [];
    me.language = '';
    me.director = '';
    me.infoPath = '';
}

Movie.prototype.addHouse = function(house) {
    if (house) {
        this.productionHouses.push(house);
    }
}
Movie.prototype.addStar = function (star) {
    if (star) {
        this.starCast.push(star);
    }
};



/**
 * Scraper for bollywood hungama
 * @constructor
 */
function BollywoodHungamaScraper() {
    this.baseUrl = 'http://www.bollywoodhungama.com';
    /**
     * Movies list url pattern for bollywood hungama takes in year and page
     * @type {string}
     */
    this.moviesListUrlPattern = 'http://www.bollywoodhungama.com/movies/list/sort/Released_in_%s/char/ALL/type/listing/page/%s';
    /**
     * Movie Detail URL pattern only takes in movie title at url end.
     * @type {string}
     */
    this.movieInfoUrlPattern = "http://www.bollywoodhungama.com/%s";
//    var http://www.bollywoodhungama.com/moviemicro/cast/id/732749/Yeh+Hai+Bakrapur
//    if (!callback) {
//        throw "Kindly pass a function that accepts [] as first param";
//    }
//    /**
//     * callback that is invoked with (error, movies) after me.scraper is done
//     * @type {callback}
//     */
//    me.callback = callback;
//    if (!callback) {
//        throw new Error("Must pass callback that accepts 'error' and 'movies' argument");
//    }

    const reqPromise = Q.nbind(request.get, request);
    const me = this;
    Q.longStackSupport = true;
    Q.onerror = true;

    /**
     * Runs the bollywood hungama scraper and returns a promise.
     */
    this.scrape = function () {
//        const years = [2013, 2014];
        const years = [2013, 2014];
        const movies = [];

        let promiseChain = Q();
        years.forEach(function (year) {
            for (let p = 1; p < 30; ++p) { //not very accurate..
                let promise = me.getMovieListHtml(year, p)
                    .then(function (movieListHtml) {
                        const moviesChunk = me.parseMovieListHtml(movieListHtml);
                        console.info("Movie Chunk of size %s added", moviesChunk.length);
                        movies.push.apply(movies, moviesChunk);
                        return moviesChunk;
                    }).then(function(moviesChunk) {
                        return me.fillMoviesChunk(moviesChunk);
                    })
                promiseChain = promiseChain.then(function() {
                    return promise;
                });
            }
        });
        return promiseChain.then(function () {
            console.info("EXITING scrape with %s movies", movies.length);
            return movies;
        });
    }


    me.fillMoviesChunk = function (moviesChunk) {
        console.log("ENTERED fillMoviesChunk");
        const defer = Q.defer();
        const promises = moviesChunk.map(function (movie) {
            try {
                    return me.getMovieInfoHtml(movie).then(function (movieInfoHtml) {
//                        console.info("movie info info = %s", movieInfoHtml);
                        return me.parseFillMovieDetail(movieInfoHtml, movie);
                    });
            } catch(ex) {
                console.error(ex.stack);
                defer.reject(e);
            }
        });
        console.log("MOVIE INFO PROMISES= %s", promises.length);
        Q.all(promises).then(function() {
            console.info("ALL MOVIE INFOS GOT");
            defer.resolve();
        }, function(ex) {
            console.error(ex.stack);
            defer.reject(ex);
        });
        console.info("EXITED fillMoviesChunk()")
        return defer.promise;
    }

    /**
     *
     * @param year movie release year
     * @param p movie list page number
     * @returns movie list html
     */
    me.getMovieListHtml = function (year, p) {
        p = p || 1;
        const moviesListUrl = util.format(me.moviesListUrlPattern, year, p);
        console.log("Future request against: " + moviesListUrl);
        return reqPromise(moviesListUrl).then(function (resp) { //I still don't get why nfbind on request doesn't work as expected.
            console.info("Got movie list html");
            let movieListHtml = resp[0].body;
            return movieListHtml;
        });
    }

    /**
     * Given a movie title returns the movie Info html.
     * @param movie basic movie object
     * @returns movie html
     */
    me.getMovieInfoHtml = function (movie) {
        console.info("ENTERED getMovieInfoHtml");
//        let titleEscaped = titleEscaped.escape(movie.infoPath);
        let movieInfoUrl = util.format(me.movieInfoUrlPattern, movie.infoPath);
        return reqPromise(movieInfoUrl).then(function (resp) {
            console.info("Made request to movie info url: %s", movieInfoUrl);
            console.info("EXITED getMovieInfoHtml");
            let movieInfoHtml = resp[0].body;
            return movieInfoHtml;
        });
    }

    me.parseMovieListHtml = function (html) {
        console.log("ENTERED parseMovieListHtml");
        const $ = cheerio.load(html);
        const $movieElems = $('ul.movlstul');
        const moviesChunk = [];
        $movieElems.each(function (i, elem) {
            const title = $('.movlstlititle a', elem).text();
            const infoPath = $('.movlstlititle a', elem).attr('href');
            const dateStr = $('.movlstlirel span', elem).text();
            const desc = $('.movlstlidesc h3', elem).text();
            if (title && dateStr && desc && infoPath) {
                const date = moment(dateStr, "D MMM YYYY");
                let movie = new Movie(title, desc, date);
                movie.infoPath = infoPath;
//                console.log("Parsed Movies: %j", movie)
                moviesChunk.push(movie);
            }
        });
//        log.info("Movie chunk size = #%s", moviesChunk.length);
        console.log("EXITED parseMovieListHtml");
        return moviesChunk;
    }


    me.parseFillMovieDetail = function (html, movie) {
        console.info("ENTERED parseFillMovieDetail");
        if (!movie) {
            throw new Error("Movie object required");
        }
        const $ = cheerio.load(html);

        //get banner houses
        //get prod houses and cast with link texts at me.path
        $('ul.mtmb15 li.mtaa00 a.mtaa00').each(function (i, elem) {
            let $e = $(elem);
            let link = $e.attr('href');
//           console.log(link);
            if (link.indexOf('/movies/company') == 0) {
//                console.log("Added house %s to movie: %s", $e.text(),movie.title);
                movie.addHouse($e.text());
//              console.log("House: " + $e.text());
            } else if (link.indexOf('/celebritymicro/') == 0) {
//                console.log("Added star %s to movie %s", $e.text(), movie.title);
                movie.addStar($e.text());
            }
        });

        //do a each in case we have multiple directors.
        $('ul.moviemicr-cast a.mtaa00').each(function (i, elem) {
            if (i == 0) {
                movie.director = $(elem).text();
            }
        });
//        console.info("Movie: %j", movie);
        console.info('EXITED parseFillMovieDetail');
        return movie;
    }
}

const bhs = new BollywoodHungamaScraper();
const outFile = argv['out'] || '/tmp/movies.json';

console.log("type of bhs = %s", typeof bhs);

//slightly dirty rewrite for Qk
bhs.scrape().done(function (movies) {
    console.log("# TOTAL Bollywood Hungama MOVIES SCRAPED", movies.length);
    let moviesObj = {'movies': movies};
    jf.writeFile(outFile, moviesObj, function(ex) {
        if (ex) {
            console.error(ex);
        } else {
            console.info("SUCCESSFLLY WROTE JSON TO: %s", outFile);
        }
    })
}, function (error) {
    console.log(error);
    console.log("reasons = %j", Q.getUnhandledReasons());
});

