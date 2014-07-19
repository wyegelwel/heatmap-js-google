function createArray(length) {
  // console.log(length)
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
    sum = 0;
    for (var i = 0; i < x.length; i++){
      sum += Math.pow(x[i] - y[i],2);
    }
    return Math.sqrt(sum);
}

function clamp(x, min, max){
  return Math.max(Math.min(x, max), min);
}

function Heatmap(options){

    /**
     * Returns the new pixel value. This function will be used in a streaming
     *  fashion
     *
     * @param oldValue
     * @param pixelCoord: list of two elements [row, col]
     * @param heatPoint: list of [[row, col], value] 
     */
    this.calculatePixelValue = undefined;

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

    this.minBB = [180, 90];
    this.maxBB = [-180, -90]

    this.cacheReady = false;
    this.cache = {};

    this.maxValue = 1;

    if (options){
      this.setOptions(options);
    }
};



Heatmap.prototype.latLngToGMLatLng = function(latLng){
  return new google.maps.LatLng(latLng[0], latLng[1]);
}

/**
 * Returns a 2d matrix where each element corresponds to a pixel on the map
 *  and the value is where on the heatmap to sample from.
 *
 * @param width: width of the canvas in pixels
 * @param height: height of the canvas in pixels
 */
Heatmap.prototype.generatePixelValues_ = function(){
  mapProjection = this.map.getProjection();

  vMaxBB = mapProjection.fromLatLngToPoint(this.latLngToGMLatLng(this.maxBB))
  vMinBB = mapProjection.fromLatLngToPoint(this.latLngToGMLatLng(this.minBB))

  console.log("value")
  console.log(vMaxBB)
  console.log(vMinBB)

  extent = this.kernelExtent();

  width = Math.ceil((vMaxBB.x - vMinBB.x)/this.cache.xStep) + extent[1]*2;
  height = Math.ceil((vMaxBB.y - vMinBB.y)/this.cache.yStep) + extent[0]*2;

  yStep = this.cache.yStep; xStep = this.cache.xStep;

  function latLngToPixelCoord(lat, lng){
      point = mapProjection.fromLatLngToPoint(new google.maps.LatLng(lat,lng));
      return pointToPixelCoord(point.x, point.y);
  }

  function pointToPixelCoord(x,y){
    return {row: (height-1) - Math.floor((y-vMinBB.y)/yStep + extent[0]), 
              col: Math.floor((x-vMinBB.x)/xStep) + extent[1]}
  }

  function pixelCoordToPoint(row, col){
      return {y: (height-row-1-extent[0])*yStep+vMinBB.y,
               x: (col-extent[1])*xStep+vMinBB.x};
  }
  
  pixelValues = createArray(height, width);
  for (var i = 0; i < this.heatData.length; i++){
    // Wrangle data in to correct transforms and form
    llValue = this.heatData[i];
    lat = llValue[0];
    lng = llValue[1];
    value = llValue[2];
    pixelCoord = latLngToPixelCoord(lat, lng)
    heatRowCol = [pixelCoord.row, pixelCoord.col];
    
    // Bounds for loop
    minRow = Math.max(0, pixelCoord.row-extent[0]);
    maxRow = Math.min(height-1, pixelCoord.row+extent[0]);
    minCol = Math.max(0, pixelCoord.col-extent[1]);
    maxCol = Math.min(width-1,pixelCoord.col+extent[1]);
    for (var row = minRow; row <= maxRow; row++){
      for (var col = minCol; col <= maxCol; col++){
        oldValue = pixelValues[row][col];
        heatPoint = [heatRowCol, value];
        pixelValues[row][col] = this.calculatePixelValue(oldValue, [row, col], 
                                                          heatPoint);
      }
    }                
  }

  this.pixelValues = pixelValues;
  this.pointToValuePixel_ = pointToPixelCoord;
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
  for (var row = 0; row < height; row++){
      for (var col = 0; col < width; col++){
          valuePixel = this.mapPixelToValuePixel_(row, col);
          if (valuePixel !== null){
            v = clamp(this.pixelValues[valuePixel.row][valuePixel.col], 0, 1);
            if (isNaN(v) || v === undefined){
              console.log("fuck!")
            }
            imgData.data[(col+row*width)*4 + 0] = v*255;
            imgData.data[(col+row*width)*4 + 1] = v*255;
            imgData.data[(col+row*width)*4 + 2] = v*255;
            imgData.data[(col+row*width)*4 + 3] = v>1e-1 ? 175 : 0;
          }
          
      } 
  }
}

Heatmap.prototype.update_ = function(that){
  
  if (that.cacheReady){
    console.log("update")
    var canvasWidth = that.canvasLayer.canvas.width;
    var canvasHeight = that.canvasLayer.canvas.height;

    that.context.clearRect(0, 0, canvasWidth, canvasHeight);

    this.recomputeCanvasCache_();

   // pixelValues = that.generatePixelValues_(canvasWidth, canvasHeight);

    imgData = that.context.getImageData(0,0,canvasWidth,canvasHeight);

    that.updatePixelData_(imgData, [], canvasWidth, canvasHeight);

    that.context.putImageData(imgData, 0,0);
  }else{
    that.recomputeCache_();
  }
}

Heatmap.prototype.recomputeCanvasCache_ = function(){
  var bounds = this.map.getBounds();
  var mapProjection = this.map.getProjection();

  // Convert lat-lng in to world coords which are uniform across map
  var maxBB = mapProjection.fromLatLngToPoint(bounds.getNorthEast());
  var minBB = mapProjection.fromLatLngToPoint(bounds.getSouthWest());

  console.log(minBB);
  console.log(maxBB);

  var yRange = maxBB.y - minBB.y;
  var xRange = maxBB.x - minBB.x

  var yStep = yRange/this.canvasLayer.canvas.height;
  var xStep = xRange/this.canvasLayer.canvas.width;

  this.cache.canvasPointBounds = {minBB: minBB, maxBB: maxBB};
  this.cache.xStep = xStep;
  this.cache.yStep = yStep;
}

Heatmap.prototype.recomputeCache_ = function(){
  if (that.map.getProjection() !== undefined){
    this.recomputeCanvasCache_();

    this.generatePixelValues_(); 

    this.mapPixelToValuePixel_ = function(mRow, mCol){
      var canvasHeight = this.canvasLayer.canvas.height;
      var valueHeight = this.pixelValues.length;
      var valueWidth = this.pixelValues[0].length;
      
      var x = mCol*this.cache.xStep + this.cache.canvasPointBounds.minBB.x;
      var y = (canvasHeight - mRow - 1) * this.cache.yStep + this.cache.canvasPointBounds.minBB.y;
      // console.log(x + ", " + y);
      var valuePixel = this.pointToValuePixel_(x,y)
      var within = valuePixel.row >= 0 && valuePixel.col >= 0 
                && valuePixel.row < valueHeight && valuePixel.col < valueWidth; 
      if (within){
        valuePixel.x = x;
        valuePixel.y = y;
        valuePixel.width = valueWidth;
        valuePixel.height = valueHeight;
        return valuePixel;
      } else{
        return null;//{valuePixel: valuePixel, x: x, y: y, width: valueWidth, height: valueHeight, this:this};
      }
    }

    this.cacheReady = true;
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
    that.update_(that);
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
  this.recomputeCache_();
  google.maps.event.addListener(map, "zoom_changed", function(){
    that.cacheReady = false;
    that.recomputeCache_();
  });
}

Heatmap.prototype.defaultKernel= function(radius){
  function kernel(distPixel){
    return 2.5*Math.exp(-(1/2)*distPixel*distPixel/radius)/Math.sqrt(2*Math.PI);
  }
  return kernel;
}

Heatmap.prototype.defaultCalculatePixelValue = function(oldValue, pixelCoord, heatPoint){
    var kernelValue = this.kernel(distance(pixelCoord, heatPoint[0]))
    var scaledValue = (1-heatPoint[1]/this.maxValue);
    return oldValue + kernelValue*scaledValue;
}

Heatmap.prototype.setOptions = function(options){
  if (options.calculatePixelValue !== undefined){
      this.calculatePixelValue = options.calculatePixelValue;
  } else if (options.kernel !== undefined){
      this.calculatePixelValue = this.defaultCalculatePixelValue;
      this.kernel = options.kernel;
  } else if (options.radius !== undefined){
      this.calculatePixelValue = this.defaultCalculatePixelValue;
      this.kernel = this.defaultKernel(options.radius);
      this.kernelExtent = function (){return [options.radius, options.radius];}
  }
  // This is intentionally put after the big if/elseif block to allow 
  //  for custom kernel extents
  if (options.kernelExtent !== undefined){
      this.kernelExtent = options.kernelExtent;
  }

  if (options.map !== undefined){
      this.map = options.map
      this.initializeCanvas_(map);
  }
  this.recomputeCache_();
}

/**
 * Adds the list of points to heatData and redraws
 *
 * @param points: list of lists of form: [[lat, lng, value], ... ]
 */
Heatmap.prototype.addPoints = function(points){
  for (var i = 0; i < points.length; i++){
    this.heatData.push(points[i]);
    this.maxValue = Math.max(points[i][2], this.maxValue);
    this.minBB = [Math.min(points[i][0], this.minBB[0]), 
                    Math.min(points[i][1], this.minBB[1])];
    this.maxBB = [Math.max(points[i][0], this.maxBB[0]), 
                    Math.max(points[i][1], this.maxBB[1])]
  }
}

/**
 * Adds point to heatData and redraws
 *
 * @param point: list with form [lat, lng, value]
 */
Heatmap.prototype.addPoint = function(point){
  this.addPoints([point]);
}
