# heatmap-js-google docs

The philosophy of heatmap-js-google is to provide a simple interface for the most common interfaces and then a more advanced interface for greater customization. 

### Heatmap class

##### Caching

Calculating the influence of each point to the surrouding area is expensive and therefore we cache it and compute it infrequently. This cache is a matrix of values that correspond to a region three times larger than the visible screen. Once you pan outside of this region, we must recompute the cache. Zooming also requires the heatmap to recompute the cache.

###### Drawing

Using the [cache of values](#caching), we interpolate the gradient for each pixel to calculate the color and push it to the screen. 

##### Constructor
| Constructor | Description |
| ----------  | ----------- |
| Heatmap(options) | Creates heatmap and passes the options to the method _setOptions()_. |

###### Methods

| Method | Return Value | Description |
| ------ | ------------ | ----------- |
| setOptions(options) | None | Modify state of the heatmap. See heatmap option below for full list of available options |
| addPoint(point) | None | Adds point to heatmap and redraws. **_point_** is expected to be a list with the form [lat, lng, value] |
| addPoints(points) | None | Adds a list of points to the heatmap and redraws. Each element **_points_** is expected to be a list with the form [lat, lng, value]. Therefore, **_points_** should take the form [[lat1, lng1, value1], [lat2, lng2, value2], ...] | 

#### Heatmap options

We have broken the heatmap options into standard and advanced. Standard will give you out-of-the-box heatmap support that should serve almost all needs. Advanced options provide full customization and are meant to be used when you want your visual to look just right.

##### Standard options
| Option | Required? | Description | Comments |
| ------ | --------- | ----------- | -------- |
| map | y | Google Maps map object | See [google maps api](https://developers.google.com/maps/documentation/javascript/examples/map-simple) |
| radius | y | the radius (in pixels!) that each point affects. The radius will be scaled based on the initial zoom so that when you zoom in the radius will increase so that the visualization scales well. | The scaling looks more natural for contour maps than for the heatmap. |
opacity | n | A value between 0 and 255 used to determine alpha of the visual | The default is 220 |
| MapType | n | Either "heatmap" or "contour". Heatmap has a falloff in value from the point supplied to the edge of the radius. Contour map uses the maximum value for each pixel amongst the points that have influence over that pixel. See [Heatmap vs Contour map](examples/heatmapVscontourmap.html) for a sense of the difference. | The default is "heatmap". As a rule of thumb, heatmap often looks better for a small number of points that are clustered while contour map looks better for a large number of points that evenly spread. |
| gradient | n | A list of colors that can be supplied to [Gradient](#gradient-class). Each element of list should be a 3-tuple or 4-tuple which corresponds to rgb or rgba. Each value should range from 0 to 255. | Default is red to blue to green ([[255,0,0], [0,0,255], [0,255,0]]) |

###### Advanced Options

When calculating the [pixel value cache](#value-cache), we loop over each point, and then loop over each pixel that point may have an affect on, which it determines by the _kernelExtent()_ (see below) or **_radius_**. For each pixel, we must assign it a value based on the previous points' influence and the current point's influence on that pixel. Then when it comes time to render the heatmap, we normalize the values to be between 0 and 1 and then interpolate the gradient based on this normalized value and assign it to the pixel on the screen. 

The functions below let you tweak how the value of each pixel in the cache is  computed.

| Option | Function Definition | Returns | Description | Comments |
| ------ | ------------------- | ------- | ----------- | -------- |
| calculatePixelValue | function(oldValue, pixelCoord, heatPoint, scaledDist) | Returns a value for the current pixel. This value will then be passed to this function the next time calculatePixelValue is called for this pixel |  Function called to determine the new value for a pixel given a point. **_oldValue_** is the value of the pixel before the current point has been applied. **_pixelCoord_** is a 2-tuple of the form [row, col]. **_heatPoint_** is a 2-tuple where the first element is the point's [row, col] and the second is the value of the point ([[row, col] value]). **_scaledDist_** is the distance between the point and the current pixel in pixel space (Euclidean distance between pixelCoord and heatPoint[0]) scaled so that zooming doesn't change the region in latitude-longitude space that the point affects. Don't feel obligated to use it. | Defining this function oftens means you don't want to define the kernel function as well. However, you must either set the **_radius_** or define a **_kernelExtent_**. Additionally, note that there is no guarentee on the order with which the points will be passed to this function. |
| kernel | function(distPixel) | Scale factor for the point's value | The default calculatePixelValue will call the kernel function of the heatmap to scale the value of point based on the distance between the current pixel's [row, col] and the point's [row, col] which is the parameter **_distPixel_**. | If you define the kernel, be sure not to have set the calculatePixelValue. |
| kernelExtent | function() | Returns a 2-tuple, each representing the "extent of the kernel". | The extent is the number of PIXELS away from heatmap point the kernal is non-zero. The extent should be an integer. If your kernel has influence over 2.5 pixels, then make the extent 3. More generally, the extent should be the ceiling of the kernel's influence. | There is an important performance implication to note. The extent can be as large as you want, however, large extents will increase the time to recompute the cache. |

### Gradient Class 
    
Class used to represent a gradient with equal spacing between colors.

##### Constructor

| Constructor | Description |
| ----------- | ----------- |
| Gradient(colors: list) | **_colors_** is expected to be a list where each element is either a 3-tuple or 4-tuple which represents the rgb or rgba of the color. Each value of rgba should range from 0 to 255. Example: colors = [[255, 0, 0], [0, 255, 0, 255], [120, 255, 0]]. Note the alpha value of the color is currently not taken into account. |

##### Methods

| Method | Return Value | Description |
| ------ | ------------ | ----------- |
| interpolateColor(x: number, [0,1]) | Returns a 3-tuple RGB of a color. | Interpolates between the colors in the gradient using x |
