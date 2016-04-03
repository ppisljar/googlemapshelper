
var getJSON = function(url, callback) {
    $.ajax({
        url: url,
        dataType: 'jsonp'
    }).done(callback)
    .error(function(err) {
        console.log(err);
    });
};


Number.prototype.toRad = function() {
    return this * Math.PI / 180;
};

Number.prototype.toDeg = function() {
    return this * 180 / Math.PI;
};

GSV = function() {
    this._streetViewService = new google.maps.StreetViewService;
    this._directionsService = new google.maps.DirectionsService;
    this._elevationService = new google.maps.ElevationService();

    this._depthMapDecoder = new this.depthMapDecoder();
};


GSV.prototype.distanceTo = function(x, y) {
    return 1;
};

GSV.prototype.getElevation = function(location, cb) {
    this._elevationService.getElevationForLocations({'locations': [location]}, function(results, status) {
        if (status == google.maps.ElevationStatus.OK) {
            if (cb) cb(results[0].elevation.toFixed(3));
        }
    });

};

GSV.prototype.pointOnLine = function(t, a, b) {
    var lat1 = a.lat().toRad(), lon1 = a.lng().toRad();
    var lat2 = b.lat().toRad(), lon2 = b.lng().toRad();

    x = lat1 + t * (lat2 - lat1);
    y = lon1 + t * (lon2 - lon1);

    return new google.maps.LatLng(x.toDeg(), y.toDeg());
};

// get path points from origin to destination
GSV.prototype.getPath = function(config, cb) {
    var self = this;
    this._directionsService.route({
        origin: config.origin,
        destination: config.destination,
        travelMode: 'DRIVING'
    }, function(result, status) {
        if (status === google.maps.DirectionsStatus.OK) {

            self.directions = result;

            var _raw_points = [];
            var route = result.routes[0];
            var path = route.legs[0].steps[0].path;// route.overview_path;
            var legs = route.legs;

            var total_distance = 0;
            for(var i=0; i<legs.length; ++i) {
                total_distance += legs[i].distance.value;
            }

            var _distance_between_points = 1;
            var segment_length = total_distance/200;
            _d = (segment_length < _distance_between_points) ? _d = _distance_between_points : _d = segment_length;

            var d = 0;
            var r = 0;
            var a, b;

            for(i=0; i<path.length; i++) {
                if(i+1 < path.length) {

                    a = path[i];
                    b = path[i+1];
                    d = google.maps.geometry.spherical.computeDistanceBetween(a, b);

                    if(r > 0 && r < d) {
                        a = self.pointOnLine(r/d, a, b);
                        d = google.maps.geometry.spherical.computeDistanceBetween(a, b);
                        _raw_points.push(a);

                        r = 0;
                    } else if(r > 0 && r > d) {
                        r -= d;
                    }

                    if(r === 0) {
                        var segs = Math.floor(d/_d);

                        if(segs > 0) {
                            for(var j=0; j<segs; j++) {
                                var t = j/segs;

                                if( t>0 || (t+i)===0  ) { // not start point
                                    var way = self.pointOnLine(t, a, b);
                                    _raw_points.push(way);
                                }
                            }

                            r = d-(_d*segs);
                        } else {
                            r = _d*( 1-(d/_d) );
                        }
                    }

                } else {
                    _raw_points.push(path[i]);
                }
            }

            if (cb) cb(_raw_points);

            return;

            var aOverviewPath = [];
            for (var i = 0, length = result.routes[0].legs.length; i < length; i++) {
                for (var j = 0, lengthJ = result.routes[0].legs[i].steps.length; j < lengthJ; j++) {
                    for (var k = 0, lengthK = result.routes[0].legs[i].steps[j].lat_lngs.length; k < lengthK; k++) {
                        aOverviewPath.push(result.routes[0].legs[i].steps[j].lat_lngs[k])
                    }
                }
            }
            for (var i = 1, length = aOverviewPath.length; i < length; i++) {
                if (self.distanceTo(aOverviewPath[i], aOverviewPath[i - 1]) < .009) {
                    aOverviewPath.splice(i--, 1);
                    length--;
                }
            }
            if (cb) cb(aOverviewPath);

        } else if (self.config.onError != null && self.config.onError instanceof Function) {
            if (cb) cb({error: true, desc: "Error pulling directions, please try again."});
        }
    });
};

GSV.prototype.getDepth = function(panoId, cb) {
    var url = "http://maps.google.com/cbk?output=json&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=" + panoId;

    var self = this;
    getJSON(url, function(data) {
        var decoded = self._depthMapDecoder.decode(data.model.depth_map);
        var depthMap = self._depthMapDecoder.parse(decoded);

        var ret = {
            data: data,
            depthMap: depthMap
        }
        self.depthreq = data;

        if (cb) cb(ret);
    });
};

GSV.prototype.saveDepth = function(panoId, outputPath, cb) {
    this.getDepth(panoId, function(data) {
        $.ajax({
            method: 'POST',
            url: 'put.php?name='+outputPath,
            data: JSON.stringify(data)
        });

        if (cb) cb();
    });
};

GSV.prototype.getPanorama = function(location, cb, radius) {
    var sensitivity = radius || 50;
    this._streetViewService.getPanoramaByLocation(location, sensitivity, function(panoData) {
        if (cb) cb(panoData);
    })
};


GSV.prototype.getImage = function(panoId, x, y) {
    var iImage = new Image;
    var self = this;
    iImage.crossOrigin = "Anonymous";
    iImage.src = ["http://cbk0.google.com/cbk?output=tile&panoid=", panoId, "&zoom=5&x=", x, "&y=", y, "&cb_client=api&fover=0&onerr=3"].join("");
    iImage.onload = function() {
      self.loadedImages++;
    };
    return iImage;
};

// get image from googlestreetview
GSV.prototype.loadImages = function(panoId, zoom) {
    this.images = [];
    this.loadingImages = 0;
    this.loadedImages = 0;
    for (var x = 0; x < 25; x++) {
        for (var y = 0; y < 12; y++) {
            this.loadingImages++;
            this.images.push({x: x, y: y, image: this.getImage(panoId, x, y)});
        }
    }
};

// stich googlestreetview panorama image into one
GSV.prototype.stichImage = function(panoId, cb) {
    var self = this;

    this.loadImages(panoId);

    var canvas = document.createElement('canvas');
    canvas.width = 512*26;
    canvas.height = 512*13;
    var context = canvas.getContext('2d');

    (fn = function() {
        if (self.loadingImages != self.loadedImages) {
            return setTimeout(fn, 100);
        }
        for (var n = 0; n < self.images.length; n++) {
            var image = self.images[n];
            context.drawImage(image.image, 0, 0, image.image.width, image.image.height, image.x * image.image.width, image.y * image.image.height, image.image.width, image.image.height);
        }
        if (cb) cb(canvas);
    })();

};

// nodejs save stiched image to file
GSV.prototype.saveImage = function(panoId, outputPath, cb) {

    var data = this.stichImage(panoId, function(canvas) {
        var data = canvas.toDataURL("image/png");
        $.ajax({
            method: 'POST',
            url: 'put.php?name='+outputPath,
            data: data
        });
        if (cb) cb();
    });

    // send to server
};

// generete metadata for googlestreetview panorama image
GSV.prototype.generateMeta = function() {

};

// nodejs save meta data to file
GSV.prototype.saveMeta = function(panorama, outputPath, cb) {
    var self = this;
    this.getElevation(panorama.location.latLng, function(elevation) {
        var data = {
            date: panorama.imageDate,
            location: {
                latLng: {
                    lat: panorama.location.latLng.lat(),
                    lng: panorama.location.latLng.lng(),
                },
                panoId: panorama.location.pano,
                description: panorama.location.description
            },
            camera: {
                centerHeading: panorama.tiles.centerHeading,
                originHeading: panorama.tiles.originHeading,
                originPitch: panorama.tiles.originPitch,
            },
            elevation: elevation
        };

        data.original = panorama;
        data.depthres = self.depthres;

        $.ajax({
            method: 'POST',
            url: 'put.php?name='+outputPath,
            data: JSON.stringify(data)
        }).done(function(data) {
            var a = 1;
        }).error(function(err){
            console.log(err);
        });
        if (cb) cb();
    })
    


};

GSV.prototype.processLocation = function(location, savepath, i) {
    var self = this;
    if (self.lock) {
        return setTimeout(function() {
            self.processLocation(location, savepath, i);
        }, 500);
    }

    self.lock = 1;


    self.getPanorama(location, function(panorama) {
        /*self.saveImage(panorama.location.pano, panorama.location.pano+'.png', function() {
            self.lock = 1;
            console.log("done");
            document.write("done");

        });*/

        self.processingCount--;
        self.path[i].panoid = panorama.location.pano;
        if (self.processingCount === 0) {
            $.ajax({
                method: 'POST',
                url: 'put.php?name='+savepath+'/path.json',
                data: JSON.stringify(self.path)
            }).done(function(data) {
                var a = 1;
            }).error(function(err){
                console.log(err);
            });
        }
        var n = "000000000" + i;
        n = n.substr(n.length - 5);
        self.saveDepth(panorama.location.pano, savepath + n + "-" + panorama.location.pano+'.depth', function() {
            self.saveMeta(panorama, savepath + n + "-" + panorama.location.pano+'.json', function() {
                self.lock = 0;
            });
        });

    });

};

// exports stiched images for a path between startpoint and endpoint
GSV.prototype.exportPath = function(config, savepath) {
    var self = this;
    this.getPath(config, function(path) {

        self.path = path;

        // lock ... process frame by frame
        self.lock = 0;
        self.processingCount = 0;
        path.forEach(function(location, i) {
            self.processingCount++;
            self.processLocation(location, savepath, i);
        });


    });
};

GSV.prototype.exportUrl = function(config, url) {
    this.getPath(config, function(path) {


        path.forEach(function(location) {
            this.getPanorama(location, function(panorama) {
                this.saveImage(panorama.panoId, url+'?name='+panorama.panoId+'.jpg');
                this.saveMeta(panorama, url+'/?name='+panorama.panoId+'.json');
            });
        });
    });
};


GSV.prototype.depthMapDecoder = function() {

    this.decode = function(rawDepthMap) {
        var self = this,
            i,
            compressedDepthMapData,
            depthMap,
            decompressedDepthMap;

        // Append '=' in order to make the length of the array a multiple of 4
        while(rawDepthMap.length %4 != 0)
            rawDepthMap += '=';

        // Replace '-' by '+' and '_' by '/'
        rawDepthMap = rawDepthMap.replace(/-/g,'+');
        rawDepthMap = rawDepthMap.replace(/_/g,'/');

        // Decode and decompress data
        compressedDepthMapData = $.base64.decode(rawDepthMap);
        decompressedDepthMap = zpipe.inflate(compressedDepthMapData);

        // Convert output of decompressor to Uint8Array
        depthMap = new Uint8Array(decompressedDepthMap.length);
        for(i=0; i<decompressedDepthMap.length; ++i)
            depthMap[i] = decompressedDepthMap.charCodeAt(i);
        return depthMap;
    };

    this.parseHeader = function(depthMap) {
        return {
            headerSize : depthMap.getUint8(0),
            numberOfPlanes : depthMap.getUint16(1, true),
            width: depthMap.getUint16(3, true),
            height: depthMap.getUint16(5, true),
            offset: depthMap.getUint16(7, true)
        };
    };

    this.parsePlanes = function(header, depthMap) {
        var planes = [],
            indices = [],
            i,
            n = [0, 0, 0],
            d,
            byteOffset;

        for(i=0; i<header.width*header.height; ++i) {
            indices.push(depthMap.getUint8(header.offset + i));
        }

        for(i=0; i<header.numberOfPlanes; ++i) {
            byteOffset = header.offset + header.width*header.height + i*4*4;
            n[0] = depthMap.getFloat32(byteOffset, true);
            n[1] = depthMap.getFloat32(byteOffset + 4, true);
            n[2] = depthMap.getFloat32(byteOffset + 8, true);
            d    = depthMap.getFloat32(byteOffset + 12, true);
            planes.push({
                n: n.slice(0),
                d: d
            });
        }

        return { planes: planes, indices: indices };
    };

    this.computeDepthMap = function(header, indices, planes) {
        var depthMap = null,
            x, y,
            planeIdx,
            phi, theta,
            v = [0, 0, 0],
            w = header.width, h = header.height,
            plane, t, p;

        depthMap = new Float32Array(w*h);

        var sin_theta = new Float32Array(h);
        var cos_theta = new Float32Array(h);
        var sin_phi   = new Float32Array(w);
        var cos_phi   = new Float32Array(w);

        for(y=0; y<h; ++y) {
            theta = (h - y - 0.5) / h * Math.PI;
            sin_theta[y] = Math.sin(theta);
            cos_theta[y] = Math.cos(theta);
        }
        for(x=0; x<w; ++x) {
            phi = (w - x - 0.5) / w * 2 * Math.PI + Math.PI/2;
            sin_phi[x] = Math.sin(phi);
            cos_phi[x] = Math.cos(phi);
        }

        for(y=0; y<h; ++y) {
            for(x=0; x<w; ++x) {
                planeIdx = indices[y*w + x];

                v[0] = sin_theta[y] * cos_phi[x];
                v[1] = sin_theta[y] * sin_phi[x];
                v[2] = cos_theta[y];

                if(planeIdx > 0) {
                    plane = planes[planeIdx];

                    t = Math.abs( plane.d / (v[0]*plane.n[0] + v[1]*plane.n[1] + v[2]*plane.n[2]) );
                    depthMap[y*w + (w-x-1)] = t;
                } else {
                    depthMap[y*w + (w-x-1)] = 9999999999999999999.;
                }
            }
        }

        return {
            width: w,
            height: h,
            depthMap: depthMap
        };
    };

    this.parse = function(depthMap) {
        var self = this,
            depthMapData,
            header,
            data,
            depthMap;

        depthMapData = new DataView(depthMap.buffer);
        header = self.parseHeader(depthMapData);
        data = self.parsePlanes(header, depthMapData);
        depthMap = self.computeDepthMap(header, data.indices, data.planes);

        return depthMap;
    };

    this.createEmptyDepthMap = function() {
        var depthMap = {
            width: 512,
            height: 256,
            depthMap: new Float32Array(512*256)
        };
        for(var i=0; i<512*256; ++i)
            depthMap.depthMap[i] = 9999999999999999999.;
        return depthMap;
    }


};

window.GSV = new GSV();
