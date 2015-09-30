angular.module('services')
    .service('$graph', function($http, AssetService, RdsUtils, appConfig) {
        // Hardcode of ontology keys
        var base = 'http://sample.domain/ontologies/';
        var corePrefix = base + 'core#';
        var displayPrefix = base + 'display#';

        /**
         * Here 'scope' parameter means some object that contains graph.
         * It can be a graph object ($scope.project for example),
         * current controller $scope with _graph inside,
         * or API response like {"@graph":[...]}
         *
         * And 'key' parameter means key name to look in the graph.
         * For example - 'core#displayName'. Key usually processing to full URI
         * with $graph.doKey method
         */

        /**
         * Looking for a graph object in a passed scope, and fix graph core position
         *
         * @example
         * // returns graphObject
         * var graph = $graph.getGraph($scope)
         *
         * @example
         * // returns graphObject
         * var dataViz = $graph.getGraph(response.data)
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @returns {Object} - Link to a graph core
         */
        function getGraph(scope) {
            var graph = scope['@graph'] || scope._graph || [];

            if (graph.length && typeof graph[0] === 'object') {
                if (/^_:b\d+$/.test(graph[0]['@id'])) { // if graph core is not a first element
                    var body = graph.filter(function(item, i) {
                        return /^https?:.+\/meta\/[\da-f-]{36}$/i.test(item['@id']) && graph.splice(i, 1)
                    });
                    graph.unshift(body[0]); // can be only one core of graph
                }
                graph = graph[0];
            } else {
                graph = scope;
            }

            return graph;
        }

        /**
         * Compile key for graph
         *
         * @example
         * // returns "http://sample.domain/ontologies/core#image"
         * $graph.doKey('image');
         *
         * @example
         * // returns "http://sample.domain/ontologies/display#menuCatalogue"
         * $graph.doKey('display#menuCatalogue');
         *
         * @param {String} key - RdfType
         * @returns {String}
         */
        function doKey(key) {
            if (!/^http/.test(key)) {
                key = (/[#:]/.test(key) ? base : corePrefix) + key;
            }
            return key;
        }

        /**
         * Returns value by graph key from graph body
         * For 'id' returns sliced UUID from '@id' key
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {String} key - RdfType
         * @returns {Array|Object|String|*}
         */
        var get = function(scope, key) {
            if (key === 'id') {
                return (getGraph(scope)['@id'] || '').split('/').pop() || scope.uuid || '';
            }
            return getGraph(scope)[doKey(key)];
        };

        /**
         * Wrapper for get method
         * Return a first element of an array that get returns
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {String} key - RdfType
         * @returns {Array|Object|String|*}
         */
        var getValue = function(scope, key) {
            var value = scope ? get(scope, key) : null;
            return value instanceof Array ? value[0] : value;
        };

        /**
         * Compile URL for API calls
         * Use appConfig urls: URL.DOMAIN and URL.API
         *
         * @example
         * // URL.DOMAIN = 'http://sample.domain'
         * // URL.API = '/api/v1'
         *
         * compileURL('/method')
         * compileURL('/api/v1/method')
         * compileURL('http://sample.domain/api/v1/method')
         *
         * // returns 'http://sample.domain/api/v1/method'
         *
         * @param {String} tail - Any piece of URL
         * @returns {String} - Full URL (URL.DOMAIN/URL.API/tail)
         */
        var compileURL = function(tail) {
            if (/^http/.test(tail)) return tail;
            if (RegExp('^' + appConfig.URL.API).test(tail)) return appConfig.URL.DOMAIN + tail;
            return appConfig.URL.DOMAIN + appConfig.URL.API + tail;
        };

        /**
         * Compile part of URL without domain for API calls
         * Use appConfig urls: URL.DOMAIN and URL.API
         *
         * @example
         * // URL.DOMAIN = 'http://sample.domain'
         * // URL.API = '/api/v1'
         *
         * compileURL('/method')
         * compileURL('/api/v1/method')
         * compileURL('http://sample.domain/api/v1/method')
         *
         * // returns '/api/v1/method'
         *
         * @param {String} tail - Any piece of URL
         * @returns {String} - API URL (/URL.API/tail)
         */
        var compileRelativeURL = function(tail) {
            if (/^http/.test(tail)) return tail.replace(appConfig.URL.DOMAIN, '');
            if (RegExp('^' + appConfig.URL.API).test(tail)) return tail;
            return appConfig.URL.API + tail;
        };

        /**
         * Create URL for UUID
         *
         * @param {graph|Array|Object|String} uuid - Can be plain uuid, or graph with '@id', or array of graphs. First found '@id' will be used for URI.
         * @returns {String} - meta-URL
         */
        var getUri4Uuid = function(uuid) {
            if (angular.isArray(uuid)) {
                var tmp;
                do {
                    tmp = getValue(uuid.shift(), 'id');
                } while (!tmp && uuid.length);
                uuid = tmp;
            }
            if (angular.isObject(uuid)) {
                uuid = getValue(uuid, 'id');
            }
            return RegExp('/meta/', 'i').test(uuid) ? uuid : appConfig.URL.DOMAIN + appConfig.URL.API + '/meta/' + uuid; // api url
        };

        /**
         * Store value in graph
         * Create RdfClass from key and store it with value in graph body
         *
         * @example
         * // graph = {"@graph": [{
         * //   "@id": "http://sample.domain/api/meta/b35fc8ee-1f65-4884-afc4-593e5fa0aa47",
         * //   "@type": "http://sample.domain/ontologies/core#Scenario"
         * // }]}
         *
         * set(graph, 'displayName', 'Title')
         *
         * // now graph is {"@graph": [{
         * //   "@id": "http://sample.domain/api/meta/b35fc8ee-1f65-4884-afc4-593e5fa0aa47",
         * //   "@type": "http://sample.domain/ontologies/core#Scenario",
         * //   "http://sample.domain/ontologies/core#displayName": ["Title"]
         * // }]}
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {String} key - RdfType
         * @param {*} val - Value to store in graph
         */
        var set = function(scope, key, val) {
            key = doKey(key);
            var graph = getGraph(scope);
            if (val['@graph']) val = val['@graph'];
            if (val instanceof Array) {
                graph[key] = val;
            } else {
                if (graph[key] === undefined) graph[key] = [];
                graph[key][0] = val;
            }
        };

        /**
         * Find node in graph object with passed id
         *
         * @example
         * // graph = {'@graph': [
         * //   {'@id': 'http://sample.domain/api/meta/10ae1313-ee55-4511-ba9f-203cda43acd8', ...},
         * //   {'@id': '_:b1', ...},
         * //   {'@id': '_:b2', ...},
         * //   {'@id': '_:b3', ...}
         * // ]}
         *
         * findById(graph, '_:b2')
         * // returns {'@id': '_:b2', ...}
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {String} id - RdfClass
         * @returns {Object} - node of graph
         */
        var findById = function(scope, id) {
            var graph = scope['@graph'] || scope._graph || scope;
            return graph.filter(function(item) { return item['@id'] === id })[0];
        };

        /**
         * Create and return blank graph
         * Method generate random uuid for '@id' field
         *
         * @example
         * createBlank('Image')
         * // returns {'@graph':[{
         * //   '@id': 'http://sample.domain/api/meta/bec7798e-1883-4b23-b302-19ec6f869731',
         * //   '@type':'http://sample.domain/ontologies/core#Image'
         * // }]}
         *
         * @example
         * createBlank('display#Scenario', ['displayName', 'description'])
         * // returns {'@graph':[{
         * //   '@id': 'http://sample.domain/api/meta/aa5f042a-0687-4842-afde-c72f46b54754',
         * //   '@type': 'http://sample.domain/ontologies/display#Scenario',
         * //   'http://sample.domain/ontologies/core#description': [''],
         * //   'http://sample.domain/ontologies/core#displayName': ['']
         * // }]}
         *
         * @example
         * createBlank('Image', null, false)
         * // returns {
         * //   '@id': 'http://sample.domain/api/meta/e17690c6-8dd5-4b10-802f-4ccf6b5b2f4d',
         * //   '@type': 'http://sample.domain/ontologies/core#Image'
         * // }
         *
         * @param {String} type - RdfType to set in '@type' field
         * @param {Array} [keysList=[]] - List of keys for create arrays for each key
         * @param {Boolean} [wrap=true] - If true, wrap graph body into {'@graph': [...]}
         * @returns {graph}
         */
        var createBlank = function(type, keysList, wrap) {
            if (wrap === undefined) wrap = true;
            var id = RdsUtils.generateUUID();
            type = doKey(type);

            var empty = {
                '@id': getUri4Uuid(id),
                '@type': type
            };

            (keysList || []).forEach(function(key) {
                empty[doKey(key)] = [''];
            });

            return wrap ? {'@graph': [empty]} : empty;
        };

        /**
         * Returns list of included items from graph body
         *
         * @private
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {String} key - RdfType for looking subset
         * @param {Boolean} [remove=false] - If true, subset will be removed from graph
         * @param {Boolean} [supply=false] - If true, each element of subset will be extended with loaded from server info
         * @param {String} [subsetKey='element'] - Key in subset object to extract array of subset elements
         * @returns {Array} - Subset
         */
        var subset = function(scope, key, remove, supply, subsetKey) {
            var subset = [];
            if (!scope || !key) return subset;
            if (!subsetKey) subsetKey = 'element';

            var graph = scope['@graph'] || scope._graph || scope;
            var tmp = getValue(scope, key);

            if (tmp && tmp['@id']) {
                tmp = graph.filter(function(obj, i) { if (obj['@id'] == tmp['@id']) return remove ? graph.splice(i, 1) : graph[i] });
                if (!tmp[0]) {
                    return subset;
                }

                tmp = get(tmp[0], subsetKey); // get set from subset object

                if (tmp && tmp.length) {
                    tmp = tmp.filter(function(item) { return !!item });
                    supply && tmp.map(function(item, i) {
                        if (!item['@id']) AssetService.getAsset(item).then(function(response) {
                            subset[i] = response.data;
                        })
                    });
                    subset = tmp;
                }
            }

            return subset;
        };

        /**
         * Copy external classes into graph body instead of links
         *
         * @example
         * // graph = {"@graph": [
         * //   {
         * //     "@id": "http://sample.domain/api/meta/b35fc8ee-1f65-4884-afc4-593e5fa0aa47",
         * //     "@type": "http://sample.domain/ontologies/core#Scenario",
         * //     "http://sample.domain/ontologies/display#collections": [{"@id": "_:b5"}]
         * //   },
         * //   {
         * //     "@id": "_:b5",
         * //     "@type": "http://sample.domain/ontologies/access#CollectionSet",
         * //     "http://sample.domain/ontologies/core#element": [
         * //       "e4108e4b-6b29-4b27-bb72-a6ebaf5ba43c",
         * //       "58e34951-2dcd-4e05-b660-803be70ed538"
         * //     ]
         * //   }
         * // ]}
         *
         * collectExternal(graph)
         *
         * // now graph equal to {"@graph": [
         * //   {
         * //     "@id": "http://sample.domain/api/meta/b35fc8ee-1f65-4884-afc4-593e5fa0aa47",
         * //     "@type": "http://sample.domain/ontologies/core#Scenario",
         * //     "http://sample.domain/ontologies/display#collections": [
         * //       "@id": "_:b5",
         * //       "@type": "http://sample.domain/ontologies/access#CollectionSet",
         * //       "http://sample.domain/ontologies/core#element": [
         * //         "e4108e4b-6b29-4b27-bb72-a6ebaf5ba43c",
         * //         "58e34951-2dcd-4e05-b660-803be70ed538"
         * //       ]
         * //     ]
         * //   },
         * //   {
         * //     "@id": "_:b5",
         * //     "@type": "http://sample.domain/ontologies/access#CollectionSet",
         * //     "http://sample.domain/ontologies/core#element": [
         * //       "e4108e4b-6b29-4b27-bb72-a6ebaf5ba43c",
         * //       "58e34951-2dcd-4e05-b660-803be70ed538"
         * //     ]
         * //   }
         * // ]}
         *
         *
         * @param scope - one item from subset, like dataViz
         * @param [from=scope] - scope to looking for external classes
         */
        var collectExternal = function(scope, from) {
            if (!from) from = scope;

            var graph = getGraph(scope);
            var keys = Object.keys(graph).forEach(function(key) {
                if (/^http:/.test(key)) {
                    var id = graph[key][0]['@id'];
                    if (/^_:b\d+$/.test(id)) {
                        graph[key][0] = findById(from, id);
                    }
                }
            });
        };

        /**
         * Returns list of ids in graph
         *
         * @example
         * getGraphIds($scope.project)
         * // returns ["http://sample.domain/api/meta/1643408c-9688-4a02-97f1-ea44ed9cd0d1", "_:b0", "_:b1", "_:b2"]
         *
         * @private
         * @param {response|$scope|graph|*} scope - Any graph container
         * @returns {Array} - List of id
         */
        var getGraphIds = function(scope) {
            var graph = scope['@graph'] || scope._graph || scope;
            return graph.map(function(item) { return item['@id'] });
        };

        /**
         * Save subset into graph like external object with antonymous id
         *
         * @example
         * // graph = {"@graph": [
         * //   {
         * //     "@id": "http://sample.domain/api/meta/b35fc8ee-1f65-4884-afc4-593e5fa0aa47",
         * //     "@type": "http://sample.domain/ontologies/core#Scenario",
         * //   }
         * // ]}
         *
         * store(graph, 'display#Collections', 'access#CollectionSet', {foo: 42})
         *
         * // returns '_:stored1554'
         * // now graph is {"@graph": [
         * //   {
         * //     "@id": "http://sample.domain/api/meta/b35fc8ee-1f65-4884-afc4-593e5fa0aa47",
         * //     "@type": "http://sample.domain/ontologies/core#Scenario",
         * //     "http://sample.domain/ontologies/display#Collections": [{"@id": "_:stored1554"}]
         * //   },
         * //   {
         * //     "@id": "_:stored1554",
         * //     "@type": "http://sample.domain/ontologies/access#CollectionSet",
         * //     "foo": 42
         * //   }
         * // ]}
         *
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {String} key - RdfType
         * @param {String} type - RdfType to set in '@type' field
         * @param {Object|Array} obj - data to store into graph
         * @returns {String} - new generated id
         */
        var store = function(scope, key, type, obj) {
            key = doKey(key);
            var graph = scope['@graph'] || scope._graph || scope;

            var id, existed_ids = getGraphIds(scope);
            do { id = '_:stored' + (Math.random() * 10000 << 0) } while ( existed_ids.indexOf(id) >= 0 );
            var newObj = angular.extend({}, {
                '@id': id,
                '@type': type
            }, obj);

            graph[0][key] = [{'@id': id}];
            graph.push(newObj);
            return id;
        };

        /**
         * Transform array of items to subset and store it to graph
         * Helper to store extracted subsets back to graph
         *
         * @param {response|$scope|graph|*} scope - Any graph container
         * @param {Array} setFields - Fields to store
         * @param {String} from - Key in graph to store
         * @param {String} to - Type of subset
         * @param {String} [fieldType] - Type of items
         */
        var wrapAndStore = function(scope, setFields, from, to, fieldType) {
            if (!(setFields || []).length) {
                delete getGraph(scope)[doKey(from)];
                return;
            }

            var tmp = {};
            tmp[doKey('element')] = setFields.map(function(item) { return {'@id': getUri4Uuid(item)} });
            store(scope, from, doKey(to), tmp);
        };


        return {
            base: base,
            doKey: doKey,
            set: set,
            findById: findById,
            createBlank: createBlank,
            getUri4Uuid: getUri4Uuid,
            getGraph: getGraph,
            store: store,
            wrapAndStore: wrapAndStore,
            get: get,
            getValue: getValue,
            collectExternal: collectExternal,
            compileURL: compileURL,
            compileRelativeURL: compileRelativeURL,

            /**
             * Load assets metadata by id from graph for specified RdfType
             *
             * @example
             * $graph.supply($scope.project, 'MenuCatalogue').then(function (menuCatalogue) {...});
             *
             * @param {response|$scope|graph|*} scope - Any graph container
             * @param {String} key - RdfType
             * @returns {Promise}
             */
            supply: function(scope, key) {
                var graph = getGraph(scope);
                var val = graph[displayPrefix + key];
                return AssetService.getAsset(val && val[0] && val[0]['@id']);
            },

            /**
             * Save graph to server using meta-url from '@id' field
             *
             * @param {response|$scope|graph|*} scope - Any graph container
             * @returns {Promise}
             */
            save: function(scope) {
                var graph = scope['@graph'] || scope._graph;

                return $http( {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    url: graph[0]['@id'],
                    data: {'@graph': graph}
                });
            },

            /**
             * Wrapper to subset
             * set remove param to false and pass other params as is
             *
             * @returns {Array} - subset
             */
            getSubset: function(scope, key, supply, subsetKey) {
                return subset(scope, key, false, supply, subsetKey);
            },

            /**
             * Wrapper to subset
             * set remove and supply params to true and pass other params as is
             *
             * @returns {Array} - subset
             */
            extractSubset: function(scope, key, subsetKey) {
                return subset(scope, key, true, true, subsetKey);
            }
        }
    });
