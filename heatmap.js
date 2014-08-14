

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
    this.gradient = new Gradient(["rgba(255,0,0,255)", "rgba(0,0,255,255)", "rgba(0,255,0,255)"])

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
     * Cache of actual pixel data with the same dimensions as pixelValues array
     */
    this.imageData = undefined;

    /**
     * Used to keep track of how many seperate addPoints function calls have been made.
     *  Once that number is great enough we need to recompute our imageData because values 
     *  will have changed noticibly 
     */ 
    this.tick = 0;

    /**
     * Tuning parameter for how many ticks we will tolerate before recomputing imageData
     * Choice is arbitrary and chosen because it "looks good" 
     */ 
    this.maxTickBeforeFlushImageData = 20;

    /**
     * Used to project lat-lng pairs to an x,y grid between 0 and 256. This avoids 
     * issues associated with lat-lng and non-uniform distance.
     * http://en.wikipedia.org/wiki/Mercator_projection
     */
    this.projection = new MercatorProjection();  

    this.inUpdate = false;

    if (options){
      this.setOptions(options);
    }
};

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
    if (point.length == 3){ // weighted
      if (point[2] < 0 || !isFinite(point[2])){
        throw "Value (" + point[2] + ") must be >0 and finite"
      }
    } else{
      this.unweightedCount += 1;
    }
    this.heatData.push(point);
    this.cacheHandleAddedPoint_(point);
  }
  this.mapHandleAddedPoints_(points);
}

/**
 * Adds point to heatData and redraws
 *
 * @param point: list with form [lat, lng, value]
 */
Heatmap.prototype.addPoint = function(point){
  this.addPoints([point]);
}

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

  function within(row, col){
    return withinBB([row, col], [0, 0], [height-1, width-1]);
  }

  var extent = this.kernelExtent();
  var rowExtent = Math.max(1, Math.ceil(extent[0]*this.scale));
  var colExtent = Math.max(1, Math.ceil(extent[1]*this.scale));
  
  var oldPointToPixelCoord = this.pixelValues !== undefined ? this.pixelValues.pointToPixelCoord : pointToPixelCoord;

  var pixelValues = createArray(height, width);
  this.pixelValues = {data: pixelValues,
                      width: width,
                      height: height,
                      latLngToPixelCoord: latLngToPixelCoord,
                      pointToPixelCoord: oldPointToPixelCoord,
                      newPointToPixelCoord: pointToPixelCoord,
                      pixelCoordToPoint: pixelCoordToPoint,
                      within: within,
                      rowExtent: rowExtent,
                      colExtent: colExtent};
}

/**
 * Helper function for addPoints(). Called on each point as it is added to heatData
 */ 
Heatmap.prototype.cacheHandleAddedPoint_ = function(point){
  if (this.cacheReady){
    this.addPointToPixelValues_(point);
    var pixelCoord = this.pixelValues.latLngToPixelCoord(point[0], point[1]);
    this.recomputeImageDataAround_(pixelCoord);
  }  
}

/**
 * Helper function for addPoints(). Called after all points have been added to heatData
 */
Heatmap.prototype.mapHandleAddedPoints_ = function(points){
  {  // Check to see if we need to recompute image data
    var canvasWidth = this.canvasLayer.canvas.width;
    var canvasHeight = this.canvasLayer.canvas.height;

    this.tick++;
    if (this.tick > this.maxTickBeforeFlushImageData){
      var start = this.mapPixelToValuePixel_(0, 0);
      this.updatePixelData_(this.imageData, canvasWidth, canvasHeight, 
                              start.row, start.col);
      this.tick = 0;
    }
  }

  // redraw
  this.updateCanvas_();
}


/**
 * Returns the bounding box of points that might be affected at pixelCoord by 
 *  a point. This is determined using the kernelExtent function and our scale
 *
 * @param pixelCoord: object with a row and col property 
 * @return: object with a minRow, maxRow, minCol, maxCol, width, and height 
 *             property
 */ 
Heatmap.prototype.getPotentialInfluenceRegion_ = function(pixelCoord){
  var rowExtent = this.pixelValues.rowExtent;
  var colExtent = this.pixelValues.colExtent;

  var minRow = Math.max(0, pixelCoord.row-rowExtent);
  var maxRow = Math.min(this.pixelValues.height-1, pixelCoord.row+rowExtent);
  var minCol = Math.max(0, pixelCoord.col-colExtent);
  var maxCol = Math.min(this.pixelValues.width-1,pixelCoord.col+colExtent);

  return {minRow: minRow, maxRow: maxRow, 
          minCol: minCol, maxCol: maxCol,
          width: maxCol - minCol, height: maxRow - minRow};
}

/**
 * Adds a single point to the pixel value matrix. 
 *
 * @param llValue: [latitude, longititude, value] 
 */ 
Heatmap.prototype.addPointToPixelValues_ = function(llValue){
  if (this.cacheReady){
    // Wrangle data in to correct transforms and form
    var lat = llValue[0]; var lng = llValue[1];
    var value = llValue.length == 3 ? llValue[2]: 1.0;

    var pixelCoord = this.pixelValues.latLngToPixelCoord(lat, lng)
    var heatRowCol = [pixelCoord.row, pixelCoord.col];
    var heatPoint = [heatRowCol, value];
    // Bounds for loop

    if (this.pixelValues.within(pixelCoord.row, pixelCoord.col)){
      var pixelValues = this.pixelValues.data;

      var region = this.getPotentialInfluenceRegion_(pixelCoord);

      for (var row = region.minRow; row <= region.maxRow; row++){
        for (var col = region.minCol; col <= region.maxCol; col++){
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
 * Used to add only a portion of the total points to the pixelValues matrix at 
 *  once. This allows spacing between batches so the ui can catch up
 *
 * @param i: which batch
 * @param step: How many items to process in a batch
 */ 
Heatmap.prototype.processBatchPoints_ = function(i, step){
  var that = this;
   setTimeout(function(){
      console.log(i)
      for (var j = Math.floor(step*i); j < Math.min(that.heatData.length, Math.floor(step*(i+1))); j++){
        var llValue = that.heatData[j];
        that.addPointToPixelValues_(llValue);               
      }    
    }, 155);
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
  var batchSize = 1000;
  var numSteps = Math.ceil(this.heatData.length/batchSize);
  var that = this;
  for (var i = 0; i < numSteps; i++){
    this.processBatchPoints_(i, batchSize);
  }
  setTimeout(function(){
    console.log("refresh")
    that.generateImageData_();
    that.pixelValues.pointToPixelCoord = that.pixelValues.newPointToPixelCoord;
    that.inUpdate = false;
    that.updateCanvas_();
  }, 155)
  
}

/**
 * Mutates the imgData param to reflect the the pixel values matrix
 *
 * @param imgData
 * @param width: width of the canvas in pixels
 * @param height: height of the canvas in pixels
 * @param offset: offset into pixelValues. Will default to offset for viewport if none is specified
 */ 
Heatmap.prototype.updatePixelData_ = function(imgData, width, height, startRow, startCol, offSet){
  var pixelValues = this.pixelValues.data;
  
  offSet = offSet === undefined ? {row: 0, col: 0} : offSet;
  startRow = startRow === undefined ? 0 : startRow;
  startCol = startCol === undefined ? 0 : startCol; 
  
  for (var row = startRow; row < startRow+height; row++){
      for (var col = startCol; col < startCol+width; col++){
        var v = pixelValues[offSet.row + row][offSet.col + col];
        v = clamp(v/this.maxValue, 0, 1);
        var color = this.gradient.interpolateColor(v);
        var rIndex = (col+row*imgData.width)*4;
        imgData.data[rIndex + 0] = color[0];
        imgData.data[rIndex + 1] = color[1];
        imgData.data[rIndex + 2] = color[2];
        imgData.data[rIndex + 3] = v>1e-3 ? this.opacity : v*this.opacity; 
      } 
  }
}

/**
 * Recomputes the pixel colors in the image data array around a particular point
 *  
 * It is worth noting that this alone will cause strange artifacts because the 
 *  rest of the array is affected when a point is added. 
 *
 * @param pixelCoord: object with a row and col property 
 */ 
Heatmap.prototype.recomputeImageDataAround_ = function(pixelCoord){
  if (this.pixelValues.within(pixelCoord.row, pixelCoord.col)){
    var region = this.getPotentialInfluenceRegion_(pixelCoord);
    this.updatePixelData_(this.imageData, region.width, region.height, 
                           region.minRow, region.minCol);
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

  return !topLeft.valid || !bottomRight.valid; 
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

    var offSet = this.mapPixelToValuePixel_(0, 0);
    /* drawing is a little strange. We have to shift the start of the draw back
     * to compensate for a shift caused by indexing into image. 
     * See: http://jsfiddle.net/loktar/cVkg3/ to get a sense of what we mean. 
     *      Notice that the lower square is drawn "lower" than you'd expect 
     *      based on the first two inputs 
     */ 
     if (this.imageData !== undefined){
        var row = Math.max(0, offSet.row);
        var col = Math.max(0, offSet.col);
        var width = col+canvasWidth < this.imageData.width ? canvasWidth : this.imageData.width;
        var height = row+canvasHeight < this.imageData.height ? canvasHeight : this.imageData.height;
        // console.log(offSet)
        // console.log({row: row, col: col, width:width, height: height});
        this.context.putImageData(this.imageData, -offSet.col, -offSet.row, col, row, width, height)
     }
    
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
 * Creates the image data cache if necessary and then fills it
 */
Heatmap.prototype.generateImageData_ = function(){
  var pixelValues = this.pixelValues;
  var width = pixelValues.width; var height = pixelValues.height;
  if (this.imageData === undefined || 
      width != this.imageData.width || height != this.imageData.height){
    this.imageData = this.context.createImageData(width, height);
  }
  
  this.updatePixelData_(this.imageData, width, height);
}

/**
 * We cache two units of data. The first is data about the canvas and map we 
 *  are working with. The second is a matrix of heat values that we calculate
 *  from the points provided by the user. This function is the umbrella 
 *  function called to update both units of data
 */ 
Heatmap.prototype.updateFullCache_ = function(){
  if (this.map.getBounds() !== undefined && !this.inUpdate){
    this.inUpdate = true;

    this.updateCanvasCache_();

    console.log("update full cache")

    this.scale = Math.max(1, Math.pow(2, map.zoom - this.initialZoom))

    this.cacheReady = true;

    this.generatePixelValues_(); 

    // this.generateImageData_();
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
  valuePixel.x = x;
  valuePixel.y = y;
  valuePixel.width = valueWidth;
  valuePixel.height = valueHeight;
  valuePixel.valid = withinBB([valuePixel.row, valuePixel.col],[0,0], 
                                [valueHeight-1, valueWidth]); 
  return valuePixel;
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
    return 2.5*Math.exp(-(1/4)*distPixel*distPixel/radius)/Math.sqrt(2*Math.PI);
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
 * @param colors: a list where each element is a valid css color string
 */
function Gradient(colors){
  var gradientColors = [];

  var canvas = document.createElement("canvas");
  canvas.width = 101; canvas.height = 1;

  var context = canvas.getContext('2d');

  context.rect(0, 0, canvas.width, canvas.height);
  var grd = context.createLinearGradient(0, 0, canvas.width, canvas.height);

  for (var i = 0; i < colors.length; i++){
    grd.addColorStop( i*( 1/( colors.length-1 ) ), colors[i] );
  }

  context.fillStyle = grd;
  context.fill();

  this.imgData = context.getImageData(0,0,canvas.width, canvas.height);
};

/**
 * Returns a rgba of the color requested by x along the gradient
 *
 * @param x is a float between 0 and 1 indexing into the gradient
 */
Gradient.prototype.interpolateColor = function(x){
  if (x >= 0 && x <= 1){
    var index = Math.round(x*100);
    var data = this.imgData.data;
    return [ data[index*4 + 0], data[index*4 + 1], data[index*4 + 2], data[index*4 + 3] ]
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