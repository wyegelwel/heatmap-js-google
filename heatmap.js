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

    this.maxValue = 1;

    if (options){
      this.setOptions(options);
    }
};

/**
 * Returns a 2d matrix where each element corresponds to a pixel on the map
 *  and the value is where on the heatmap to sample from.
 *
 * @param width: width of the canvas in pixels
 * @param height: height of the canvas in pixels
 */
Heatmap.prototype.generatePixelValues_ = function(width, height){
  bounds = this.map.getBounds();
  mapProjection = this.map.getProjection();
  

  // Convert lat-lng in to world coords which are uniform across map
  maxBB = mapProjection.fromLatLngToPoint(bounds.getNorthEast())
  minBB = mapProjection.fromLatLngToPoint(bounds.getSouthWest())
  
  yRange = maxBB.y - minBB.y;
  xRange = maxBB.x - minBB.x

  yStep = yRange/height;
  xStep = xRange/width;

  function latLngToPixelCoord(lat, lng){
      point = mapProjection.fromLatLngToPoint(new google.maps.LatLng(lat,lng));
      return pointToPixelCoord(point.x, point.y);
  }

  function pointToPixelCoord(x,y){
      return {row: (height-1) - Math.floor((y-minBB.y)/yStep), 
                col: Math.floor((x-minBB.x)/xStep)}
  }

  function pixelCoordToPoint(row, col){
      return {y: (height-row-1)*yStep+minBB.y,
               x: col*xStep+minBB.x};
  }

  pixelValues = createArray(height, width);
  extent = this.kernelExtent();
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
  return pixelValues;
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
          v = clamp(pixelValues[row][col], 0, 1);
          imgData.data[(col+row*width)*4 + 0] = v*255;
          imgData.data[(col+row*width)*4 + 1] = v*255;
          imgData.data[(col+row*width)*4 + 2] = v*255;
          imgData.data[(col+row*width)*4 + 3] = v>1e-1 ? 175 : 0;
      } 
  }
}

Heatmap.prototype.update_ = function(that){
  console.log("update")
  if (that.map.getProjection() !== undefined){
    var canvasWidth = that.canvasLayer.canvas.width;
    var canvasHeight = that.canvasLayer.canvas.height;

    that.context.clearRect(0, 0, canvasWidth, canvasHeight);

    pixelValues = that.generatePixelValues_(canvasWidth, canvasHeight);

    imgData = that.context.getImageData(0,0,canvasWidth,canvasHeight);

    that.updatePixelData_(imgData, pixelValues, canvasWidth, canvasHeight);

    that.context.putImageData(imgData, 0,0);
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
