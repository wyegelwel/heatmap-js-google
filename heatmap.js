

function Heatmap(options){

    /**
     * Returns a value between 0 and 1 which is used to scale the value of a 
     * point
     * 
     * @param distance between heatmap point and pixel in pixel space     
     */
    this.kernel = undefined;

    /**
     * Returns a list of two values, each representing the "extent of the 
     *  kernel".
     * This extent is the number of PIXELS away from heatmap point the kernal
     *  is non-zero. 
     *
     * The extent should be an integer. If your kernel has influence over 2.5
     *  pixels, then make the extent 3. More generally, the extent should be 
     *  the ceiling of the kernels influence.
     *
     * Visually, if x is your heatmap point and e is the pixels where the 
     *  kernel is non-zero, then the kernelExtent() should return [2,2] because
     *  at most two pixels from the heatmap point have non-zero kernel. 
     *                  
     *              - - - e - - -
     *              - - e e e - -
     *              - e e x e e -
     *              - - e e e - - 
     *              - - - e - - - 
     *
     * @performanceImplication This can be as large as you want, however, 
     *                         large extents will affect run time.     
     */
    this.kernelExtent = undefined;

    /**
     * Exposed canvas layer for the map which we will be drawing on.
     */
    this.canvasLayer = null;

    /**
     * Exposed canvas context which will accept draw calls.
     */
    this.context = null;

    /**
     * Map we are drawing over
     */ 
    this.map = null;

    this.heatData = [];

    /**
     * Specifies when the cache has been built to denote when we are ready to draw
     */
    this.cacheReady = false;

    /**
     * Stores values associated with the canvas that are used throughout the code
     */
    this.cache = {};

    /**
     * Stores gradient specified. red to blue to green is the default.
     */
    this.gradient = new Gradient([[255,0,0], [0,0,255], [0,255,0]])

    /**
     * Stores the maximum value from the weighted points. This is used to scale them 
     * down to the range of [0,1]
     */ 
    this.maxValue = 1;

    /**
     * Stores the number of unweighted points added to the map. 
     * This is currently not used.
     */ 
    this.unweightedCount = 0;

    /**
     * scale is used to scale the distances calculated and the extent specified so that
     * zooming will perserve the look of the map
     */
    this.scale = 1;

    /**
     * Used to determine scale. It is set to the zoom from the map when it is passed in
     */
    this.initialZoom = -1;

    /**
     * Used to determine the opacity of the colors we render
     */ 
    this.opacity = 220;

    /**
     * Used to project lat-lng pairs to an x,y grid between 0 and 256. This avoids 
     * issues associated with lat-lng and non-uniform distance.
     * http://en.wikipedia.org/wiki/Mercator_projection
     */
    this.projection = new MercatorProjection();

    if (options){
      this.setOptions(options);
    }
};

/**
 * Creates the heat value matrix and stores the size as well as helper 
 *  functions for indexing into the matrix
 */ 
Heatmap.prototype.createPixelValueObject_ = function(){
  var projection = this.projection;
  var cHeight = this.canvasLayer.canvas.height;
  var cWidth = this.canvasLayer.canvas.width; 
  
  var vMinBB = this.cache.CanvasRowColToPoint(cHeight*2, cWidth*-1);
  var vMaxBB = this.cache.CanvasRowColToPoint(cHeight*-1, cWidth*2);

  var width = cWidth*3;
  var height = cHeight*3;

  var yStep = this.cache.yStep; xStep = this.cache.xStep;

  function latLngToPixelCoord(lat, lng){
      point = projection.fromLatLngToPoint(lat, lng);
      return pointToPixelCoord(point.x, point.y);
  }

  function pointToPixelCoord(x,y){
    return {row: (height-1) - Math.floor((y-vMinBB.y)/yStep), 
              col: Math.floor((x-vMinBB.x)/xStep)}
  }

  function pixelCoordToPoint(row, col){
      return {y: (height-row-1)*yStep+vMinBB.y,
               x: col*xStep+vMinBB.x};
  }

  var extent = this.kernelExtent();
  var rowExtent = Math.max(1, Math.ceil(extent[0]*this.scale));
  var colExtent = Math.max(1, Math.ceil(extent[1]*this.scale));
  
  var pixelValues = createArray(height, width);
  this.pixelValues = {data: pixelValues,
                      width: width,
                      height: height,
                      latLngToPixelCoord: latLngToPixelCoord,
                      pointToPixelCoord: pointToPixelCoord,
                      pixelCoordToPoint: pixelCoordToPoint,
                      rowExtent: rowExtent,
                      colExtent: colExtent};
}

/**
 * Modify state of the heatmap. See heatmap option docs for full list of 
 *  available options
 */
Heatmap.prototype.setOptions = function(options){
  if (options.calculatePixelValue !== undefined){
    this.calculatePixelValue = options.calculatePixelValue;
    this.maxValue = 1;
  } else if (options.kernel !== undefined){
    this.calculatePixelValue = this.defaultCalculatePixelValue_;
    this.kernel = options.kernel;
    this.maxValue = 1;
  } else if (options.radius !== undefined){
    this.calculatePixelValue = this.defaultCalculatePixelValue_;
    this.kernel = this.defaultKernel_(options.radius);
    this.radius = options.radius;
    var ceilRadius = Math.ceil(options.radius);
    this.kernelExtent = function (){return [ceilRadius, ceilRadius];}

    this.initialZoom = map.zoom;
    this.scale = 1;
    this.maxValue = 1;
  } 

  // This is intentionally put after the big if/elseif block to allow 
  //  for custom kernel extents
  if (options.kernelExtent !== undefined){
    this.kernelExtent = options.kernelExtent;

      
    this.initialZoom = map.zoom;
    this.scale = 1;
  }

  if (options.MapType === "contour"){
    if (this.radius !== undefined){
      this.calculatePixelValue = this.contourCalculatePixelValue_(this.radius);
      this.maxValue = 1;
    }
  } else if (options.MapType === "heatmap"){
    if (this.radius !== undefined){
      this.calculatePixelValue = this.defaultCalculatePixelValue_;
      this.maxValue = 1;
    }
  }

  if (options.gradient !== undefined){
    this.gradient = new Gradient(options.gradient);
  }

  if (options.opacity !== undefined){
    this.opacity = options.opacity;
  }

  if (options.map !== undefined){
    this.map = options.map;
    this.initialZoom = map.zoom;
    this.scale = 1;
    this.initializeCanvas_(map);
  }


  this.updateFullCache_();
  this.updateCanvas_();
}

/**
 * Adds the list of points to heatData and redraws
 *
 * @param points: list of lists of form: [[lat, lng, value], ... ]
 */
Heatmap.prototype.addPoints = function(points){
  for (var i = 0; i < points.length; i++){
    var point = points[i];
    this.heatData.push(point);
    if (point.length == 3){ // weighted
      // this.maxValue = Math.max(point[2], this.maxValue);
    } else{
      this.unweightedCount += 1;
    }
  }
  this.addPointToPixelValues_(point);
  this.updateCanvas_();
}

/**
 * Adds point to heatData and redraws
 *
 * @param point: list with form [lat, lng, value]
 */
Heatmap.prototype.addPoint = function(point){
  this.addPoints([point]);
}

Heatmap.prototype.addPointToPixelValues_ = function(llValue){
  if (this.cacheReady){
    // Wrangle data in to correct transforms and form
    var lat = llValue[0]; var lng = llValue[1];
    var value = llValue.length == 3 ? llValue[2]: 1.0;

    var pixelCoord = this.pixelValues.latLngToPixelCoord(lat, lng)
    var heatRowCol = [pixelCoord.row, pixelCoord.col];
    var heatPoint = [heatRowCol, value];
    // Bounds for loop

    if (withinBB([pixelCoord.row, pixelCoord.col], [0, 0],
                  [this.pixelValues.height-1, this.pixelValues.width-1])){
      var pixelValues = this.pixelValues.data;

      var rowExtent = this.pixelValues.rowExtent;
      var colExtent = this.pixelValues.colExtent;

      var minRow = Math.max(0, pixelCoord.row-rowExtent);
      var maxRow = Math.min(this.pixelValues.height-1, pixelCoord.row+rowExtent);
      var minCol = Math.max(0, pixelCoord.col-colExtent);
      var maxCol = Math.min(this.pixelValues.width-1,pixelCoord.col+colExtent);
      for (var row = minRow; row <= maxRow; row++){
        for (var col = minCol; col <= maxCol; col++){
          var oldValue = pixelValues[row][col];
          var scaledDist = distance([row,col], heatRowCol)/this.scale
          pixelValues[row][col] = this.calculatePixelValue(oldValue, [row, col], 
                                                            heatPoint, scaledDist);
          this.maxValue = Math.max(pixelValues[row][col], this.maxValue);
        }
      }     
    } 
  }
}

/**
 * Returns a 2d matrix where each element corresponds to a pixel on the map
 *  and the value is where on the heatmap to sample from.
 *
 * @param width: width of the canvas in pixels
 * @param height: height of the canvas in pixels
 */
Heatmap.prototype.generatePixelValues_ = function(){
  this.createPixelValueObject_();
  

  for (var i = 0; i < this.heatData.length; i++){
    var llValue = this.heatData[i];
    this.addPointToPixelValues_(llValue);               
  }
}

/**
 * Mutates the imgData param to reflect the the pixel values matrix
 *
 * @param imgData
 * @param pixelValues: {@see generatePixelValues}
 * @param width: width of the canvas in pixels
 * @param height: height of the canvas in pixels
 */ 
Heatmap.prototype.updatePixelData_ = function(imgData, pixelValues, width, height){
  var pixelValues = this.pixelValues.data;
  var offSet = this.mapPixelToValuePixel_(0, 0);
  for (var row = 0; row < height; row++){
      for (var col = 0; col < width; col++){
        var v = pixelValues[offSet.row + row][offSet.col + col];
        v = clamp(v/this.maxValue, 0, 1);
        var color = this.gradient.interpolateColor(v);
        imgData.data[(col+row*width)*4 + 0] = color[0];
        imgData.data[(col+row*width)*4 + 1] = color[1];
        imgData.data[(col+row*width)*4 + 2] = color[2];
        imgData.data[(col+row*width)*4 + 3] = v>1e-3 ? this.opacity : v*this.opacity;  
      } 
  }
}

/**
 * Returns true if our heat value matrix needs to be updated because the map's
 *  bounds are no longer contained in the cache
 */ 
Heatmap.prototype.pixelValuesNeedsUpdate_ = function(){
  var canvasWidth = this.canvasLayer.canvas.width;
  var canvasHeight = this.canvasLayer.canvas.height;
  var topLeft = this.mapPixelToValuePixel_(0, 0);
  var bottomRight = this.mapPixelToValuePixel_(canvasHeight ,canvasWidth);

  var minBB = [0, 0];
  var maxBB = [this.pixelValues.height-1, this.pixelValues.width-1];

  return topLeft === null || bottomRight === null; 
}

/**
 * Umbrella function that handles redrawing the canvas as well as updating 
 *  caches as necessary
 */ 
Heatmap.prototype.updateCanvas_ = function(){
  if (this.cacheReady){
    var canvasWidth = this.canvasLayer.canvas.width;
    var canvasHeight = this.canvasLayer.canvas.height;

    this.updateCanvasCache_();

    if (this.pixelValuesNeedsUpdate_()){
      this.updateFullCache_();
    }

    this.context.clearRect(0, 0, canvasWidth, canvasHeight);
    
    imgData = this.context.getImageData(0,0,canvasWidth,canvasHeight);

    this.updatePixelData_(imgData, [], canvasWidth, canvasHeight);

    this.context.putImageData(imgData, 0,0);
  }else{
    this.updateFullCache_();
  }
}

/**
 * Updates data involved with the canvas and caches it. 
 */
Heatmap.prototype.updateCanvasCache_ = function(){
  var bounds = this.map.getBounds();

  // Convert lat-lng in to world coords which are uniform across map
  var northEast = bounds.getNorthEast();
  var southWest = bounds.getSouthWest();
  var maxBB = this.projection.fromLatLngToPoint(northEast.lat(), northEast.lng());
  var minBB = this.projection.fromLatLngToPoint(southWest.lat(), southWest.lng());

  var yRange = maxBB.y - minBB.y;
  var xRange = maxBB.x - minBB.x

  var height = this.canvasLayer.canvas.height;
  var width = this.canvasLayer.canvas.width;

  var yStep = yRange/height;
  var xStep = xRange/width;

  this.cache.canvasPointBounds = {minBB: minBB, maxBB: maxBB};
  this.cache.pointToCanvasRowCol = function (x,y){
    var row = (height - 1) - Math.floor((y-minBB.y) / yStep);
    var col = Math.floor((x - minBB.x) / xStep); 
    return {row: row, col: col};
  }
  this.cache.CanvasRowColToPoint = function(row, col){
    var x = col*xStep + minBB.x;
    var y = (height - row - 1) * yStep + minBB.y;
    return {x: x, y: y};
  }
  this.cache.xStep = xStep;
  this.cache.yStep = yStep;
}

/**
 * We cache two units of data. The first is data about the canvas and map we 
 *  are working with. The second is a matrix of heat values that we calculate
 *  from the points provided by the user. This function is the umbrella 
 *  function called to update both units of data
 */ 
Heatmap.prototype.updateFullCache_ = function(){
  if (this.map.getBounds() !== undefined &&  this.heatData.length > 0){
    this.updateCanvasCache_();

    this.scale = Math.max(1, Math.pow(2, map.zoom - this.initialZoom))

    this.cacheReady = true;

    this.generatePixelValues_(); 
  }
}

/**
 * Maps the (map_row, map_col) pair of an element on the canvas to a
 *  (value_row, value_col) pair which indexes into the heat value matrix.
 *  If the mapped heat value index is outside of the matrix, null is returned.   
 *
 * @param mRow: row index into map canvas
 * @param mCol: col index into map canvas
 */
Heatmap.prototype.mapPixelToValuePixel_ = function(mRow, mCol){
  var canvasHeight = this.canvasLayer.canvas.height;
  var valueHeight = this.pixelValues.height;
  var valueWidth = this.pixelValues.width;
  
  var cPoint = this.cache.CanvasRowColToPoint(mRow, mCol);
  var x = cPoint.x; var y = cPoint.y;

  var valuePixel = this.pixelValues.pointToPixelCoord(x,y)
  var within = valuePixel.row >= 0 && valuePixel.col >= 0 
            && valuePixel.row < valueHeight && valuePixel.col < valueWidth; 
  if (withinBB([valuePixel.row, valuePixel.col],[0,0], 
                [valueHeight-1, valueWidth])){
    valuePixel.x = x;
    valuePixel.y = y;
    valuePixel.width = valueWidth;
    valuePixel.height = valueHeight;
    return valuePixel;
  } else{
    return null
  }
}

/**
 * Given a map, initializes this.canvasLayer, and this.context
 *
 * @param map
 */ 
Heatmap.prototype.initializeCanvas_ = function(map){
  that = this;
  var updateHandler = function(){
    that.updateCanvas_();
  };

  var canvasLayerOptions = {
    map: map,
    resizeHandler: updateHandler,
    animate: false,
    updateHandler: updateHandler,
    resolutionScale: window.devicePixelRatio || 1
  };
  this.canvasLayer = new CanvasLayer(canvasLayerOptions);
  this.context = this.canvasLayer.canvas.getContext('2d');
  this.updateFullCache_();
  google.maps.event.addListener(map, "zoom_changed", function(){
    that.cacheReady = false;
    that.updateFullCache_();
  });
}

Heatmap.prototype.defaultKernel_= function(radius){
  function kernel(distPixel){
    return 2.5*Math.exp(-(1/2)*distPixel*distPixel/radius)/Math.sqrt(2*Math.PI);
  }
  return kernel;
}

Heatmap.prototype.defaultCalculatePixelValue_ = function(oldValue, pixelCoord, heatPoint, scaledDist){
  var kernelValue = this.kernel(distance(pixelCoord, heatPoint[0]))
  return oldValue + kernelValue*heatPoint[1];
}

Heatmap.prototype.contourCalculatePixelValue_ = function(radius){
  var contourFunc = function(oldValue, pixelCoord, heatPoint, scaledDist){
    if (scaledDist < radius){
      return Math.max(oldValue, heatPoint[1]);
    } else{
      return oldValue;
    }
  }
  return contourFunc;
}


/***********************************************************
 * Helper Classes
 ***********************************************************/

/**
 * Class to represent a gradient with equal spacing between colors. 
 *  
 * @param colors: a list where each element is either a 3-tuple or 4-tuple
 *                  which represents the rgb or rgba of the color (0-255)
 */
function Gradient(colors){
  var gradientColors = [];
  colors.map(function(color){
    if (color.length == 3){
      gradientColors.push([color[0], color[1], color[2], 1]);
    }else if (color.length == 4){
      gradientColors.push(color);
    } else{
      throw "Color should have either 3 channels (rgb) or 4 channels (rbga)";
    }
  });
  this.colors = gradientColors;
};

/**
 * Returns a rgba of the color requested by x along the gradient
 *
 * @param x is a float between 0 and 1 indexing into the gradient
 */
Gradient.prototype.interpolateColor = function(x){
  if (x >= 0 && x <= 1){
    var colorSpacing = 1.0/(this.colors.length-1);

    var lowIndex = Math.floor(x / colorSpacing);
    if (lowIndex == this.colors.length-1){
      return this.colors[lowIndex];
    }
    var highIndex = lowIndex + 1;
    
    var lowColor = this.colors[lowIndex];
    var highColor = this.colors[highIndex];

    var interpolator = x / colorSpacing - lowIndex;
    var color = [];
    for (var i = 0; i < 3; i++){
      color[i] = (1-interpolator) * lowColor[i] + interpolator * highColor[i];
    }

    return color;  
  } else{
    throw "x (" + x +") must be between 0 and 1";
  }
}

/** @constructor. Code from google's mercator projection example: 
https://developers.google.com/maps/documentation/javascript/examples/map-coordinates */
function MercatorProjection() {
  var TILE_SIZE = 256;
  this.pixelOrigin_ = {x: TILE_SIZE / 2, y: TILE_SIZE / 2};
  this.pixelsPerLonDegree_ = TILE_SIZE / 360;
  this.pixelsPerLonRadian_ = TILE_SIZE / (2 * Math.PI);
}
/*
 * Returns the Mercator projection of the (lat, lng) pair. The returned value
 *  is an object with an 'x' and 'y' value defined. 
 *  Both x and y has range [0,256]
 *
 * See https://developers.google.com/maps/documentation/javascript/maptypes#WorldCoordinates
 *  for a solid treatment of the projection
 *
 * @param lat: latitude of point
 * @param lng: longitude of point
 */
MercatorProjection.prototype.fromLatLngToPoint = function(lat, lng) {
  var me = this;
  var point = {x: 0, y: 0};
  var origin = me.pixelOrigin_;

  point.x = origin.x + lng * me.pixelsPerLonDegree_;

  // Truncating to 0.9999 effectively limits latitude to 89.189. This is
  // about a third of a tile past the edge of the world tile.
  var siny = clamp(Math.sin(degreesToRadians(lat)), -0.9999,
      0.9999);
  point.y = origin.y + 0.5 * Math.log((1 + siny) / (1 - siny)) *
      -me.pixelsPerLonRadian_;
  return point;
};

/**
 * Utility functions
 */

function createArray(length) {
    var arr = new Array(length || 0),
        i = length;

    if (arguments.length > 1) {
        var args = Array.prototype.slice.call(arguments, 1);
        while(i--) arr[length-1 - i] = createArray.apply(this, args);
    }else{
      while(i--) arr[length-1 - i] = 0;
    }

    return arr;
}

function distance(x,y){
    var sum = 0;
    for (var i = 0; i < x.length; i++){
      sum += Math.pow(x[i] - y[i],2);
    }
    return Math.sqrt(sum);
}

function clamp(x, min, max){
  return Math.max(Math.min(x, max), min);
}

function withinBB(p, min, max){
  return p[0] >= min[0] && p[1] >= min[1] && p[0] <= max[0] && p[1] <= max[1];
}

function degreesToRadians(deg) {
  return deg * (Math.PI / 180);
}