# heatmap-js-google 
Heatmap utility for google maps that provides users with a greater control.

When working with google map's builtin heatmap utility, I found I wanted greater control over how points were drawn. This project provides users with built-ins for a standard heatmap as well as a contour map (see the examples below). If you find yourself wanting greater control than that, we expose functionality to pass in functions that will process the points you provide. You have all the control you could want.

# Performance

heatmap-js-google has been tested with up to 100,000 points and it works fairly quickly. Feel for yourself. We cache a region 3 times larger than current viewport so that while you stay within this cache, panning should be completely responsive. Once you move outside of this cache, we must recompute the cache which will provide a slight delay. Zooming also causes a delay. 

We currently process all points when the cache must be re-computed. A future release will use a spatial data structure to speed up this process.

# Using heatmap-js-google

To use heatmap-js-google, you will need to include both heatmap.js and CanvasLayer.js. CanvasLayer must be included first. 

```html
<script src="path/to/CanvasLayer.js"></script>
<script src="path/to/heatmap.js"></script>
```

Once you have created a google maps object, (see https://developers.google.com/maps/documentation/javascript/examples/map-simple), create a heatmap object and pass it options. Below will generate a standard heatmap like the one you would get using google's heatmap api.

```javascript
heatmap = new Heatmap({map: map, 
                       radius: 3});
```

Finally, pass in the points you want to render and you are done! Remember, you may call addPoint(...) or addPoints(...) whenever you like. Each point must be either a 2-tuple or a 3-tuple where the first two elements are the latitude and longitude of the point and the third element is the value of the point. 

```javascript
data = [[40, -75, 5], [40, -74], [39,-75, 2]];
heatmap.addPoints(data);
```

There are plenty of options so that you can customize the heatmap to you liking. To see the full list, see our extended docs. 

# Examples

* Heatmap vs Contour map: 
* Mouse over add points: 
