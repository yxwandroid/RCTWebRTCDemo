'use strict';

import React, {Component} from 'react';
import {
    AppRegistry,
    StyleSheet,
    Text,
    TouchableHighlight,
    View,
    TextInput,
    ListView,
    Platform,
    Button
} from 'react-native';

import io from 'socket.io-client';


const socket = io.connect('https://react-native-webrtc.herokuapp.com', {transports: ['websocket']});
// const socket = io.connect('https://192.168.1.26:4443', {transports:['websocket']});

import {
    RTCPeerConnection,
    RTCMediaStream,
    RTCIceCandidate,
    RTCSessionDescription,
    RTCView,
    MediaStreamTrack,
    getUserMedia
} from 'react-native-webrtc';
const configuration = {
    "iceServers": [
        {
            "url": "stun:stun.l.google.com:19302"
        }
    ]
};

const pcPeers = {};
let localStream;

function getLocalStream(isFront, callback) {

    let videoSourceId;

    // on android, you don't have to specify sourceId manually, just use facingMode
    // uncomment it if you want to specify
    if (Platform.OS === 'ios') {
        MediaStreamTrack.getSources(sourceInfos => {
            console.log("sourceInfos: ", sourceInfos);

            for (const i = 0; i < sourceInfos.length; i++) {
                const sourceInfo = sourceInfos[i];
                if (sourceInfo.kind == "video" && sourceInfo.facing == (isFront
                        ? "front"
                        : "back")) {
                    videoSourceId = sourceInfo.id;
                }else{

                }

            }
        });
    }
    getUserMedia({
        audio: true,
        speaker: true,
        video: {
            mandatory: {
                minWidth: 640, // Provide your own width, height and frame rate here
                minHeight: 360,
                minFrameRate: 30
            },
            facingMode: (isFront
                ? "user"
                : "environment"),
            optional: (videoSourceId
                ? [
                    {
                        sourceId: videoSourceId
                    }
                ]
                : [])
        }
    }, function (stream) {
        console.log('getUserMedia success', stream);
        callback(stream);
    }, logError);
}

function join(roomID) {
    socket
        .emit('join', roomID, function (socketIds) {
            console.log('join', socketIds);
            for (const i in socketIds) {
                const socketId = socketIds[i];
                createPC(socketId, true);
            }
        });
}

function createPC(socketId, isOffer) {
    const pc = new RTCPeerConnection(configuration);
    pcPeers[socketId] = pc;

    pc.onicecandidate = function (event) {
        console.log('onicecandidate', event.candidate);
        if (event.candidate) {
            socket.emit('exchange', {
                'to': socketId,
                'candidate': event.candidate
            });
        }
    };

    function createOffer() {
        pc
            .createOffer(function (desc) {
                console.log('createOffer', desc);
                pc.setLocalDescription(desc, function () {
                    console.log('setLocalDescription', pc.localDescription);
                    socket.emit('exchange', {
                        'to': socketId,
                        'sdp': pc.localDescription
                    });
                }, logError);
            }, logError);
    }

    pc.onnegotiationneeded = function () {
        console.log('onnegotiationneeded');
        if (isOffer) {
            createOffer();
        }
    }

    pc.oniceconnectionstatechange = function (event) {
        console.log('oniceconnectionstatechange', event.target.iceConnectionState);
        if (event.target.iceConnectionState === 'completed') {
            setTimeout(() => {
                getStats();
            }, 1000);
        }
        if (event.target.iceConnectionState === 'connected') {
            createDataChannel();
        }
    };
    pc.onsignalingstatechange = function (event) {
        console.log('onsignalingstatechange', event.target.signalingState);
    };

    pc.onaddstream = function (event) {
        console.log('onaddstream', event.stream);
        container.setState({info: 'One peer join!'});

        const remoteList = container.state.remoteList;
        remoteList[socketId] = event
            .stream
            .toURL();
        container.setState({remoteList: remoteList});
    };
    pc.onremovestream = function (event) {
        console.log('onremovestream', event.stream);
    };

    pc.addStream(localStream);
    function createDataChannel() {
        if (pc.textDataChannel) {
            return;
        }
        const dataChannel = pc.createDataChannel("text");

        dataChannel.onerror = function (error) {
            console.log("dataChannel.onerror", error);
        };

        dataChannel.onmessage = function (event) {
            console.log("dataChannel.onmessage:", event.data);
            container.receiveTextData({user: socketId, message: event.data});
        };

        dataChannel.onopen = function () {
            console.log('dataChannel.onopen');
            container.setState({textRoomConnected: true});
        };

        dataChannel.onclose = function () {
            console.log("dataChannel.onclose");
        };

        pc.textDataChannel = dataChannel;
    }
    return pc;
}

function exchange(data) {
    const fromId = data.from;
    let pc;
    if (fromId in pcPeers) {
        pc = pcPeers[fromId];
    } else {
        pc = createPC(fromId, false);
    }

    if (data.sdp) {
        console.log('exchange sdp', data);
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
                if (pc.remoteDescription.type == "offer")
                    pc.createAnswer(function (desc) {
                        console.log('createAnswer', desc);
                        pc.setLocalDescription(desc, function () {
                            console.log('setLocalDescription', pc.localDescription);
                            socket.emit('exchange', {
                                'to': fromId,
                                'sdp': pc.localDescription
                            });
                        }, logError);
                    }, logError);
            }
            , logError);
    } else {
        console.log('exchange candidate', data);
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function leave(socketId) {
    console.log('leave', socketId);
    const pc = pcPeers[socketId];
    const viewIndex = pc.viewIndex;
    pc.close();
    delete pcPeers[socketId];

    const remoteList = container.state.remoteList;
    delete remoteList[socketId]
    container.setState({remoteList: remoteList});
    container.setState({info: 'One peer leave!'});
}

socket
    .on('exchange', function (data) {
        exchange(data);
    });
socket.on('leave', function (socketId) {
    leave(socketId);
});

socket.on('connect', function (data) {
    console.log('connect');
    getLocalStream(true, function (stream) {
        localStream = stream;
        container.setState({
            selfViewSrc: stream.toURL()
        });
        container.setState({status: 'ready', info: 'Please enter or create room ID'});

    });
});

function logError(error) {
    console.log("logError", error);
}

function mapHash(hash, func) {
    const array = [];
    for (const key in hash) {
        const obj = hash[key];
        array.push(func(obj, key));
    }
    return array;
}

function getStats() {
    const pc = pcPeers[Object.keys(pcPeers)[0]];
    if (pc.getRemoteStreams()[0] && pc.getRemoteStreams()[0].getAudioTracks()[0]) {
        const track = pc
            .getRemoteStreams()[0]
            .getAudioTracks()[0];
        console.log('track', track);
        pc.getStats(track, function (report) {
            console.log('getStats report', report);
        }, logError);
    }
}

let container;

export default class RCTWebRTCDemo extends Component {

    constructor(props) {
        super(props);
        this.ds = new ListView.DataSource({
            rowHasChanged: (r1, r2) => true
        });
        this.state = {
            info: 'Initializing',
            status: 'init',
            roomID: '',
            isFront: true,
            selfViewSrc: null,
            remoteList: {},
            textRoomConnected: false,
            textRoomData: [],
            textRoomValue: ''
        }
        this._press = this
            ._press
            .bind(this);

        this._switchVideoType = this
            ._switchVideoType
            .bind(this);

        this.receiveTextData = this
            .receiveTextData
            .bind(this);
        this._textRoomPress = this
            ._textRoomPress
            .bind(this);

    }

    componentDidMount() {
        container = this;
        join('111');
    }
    _press(event) {
        this
            .refs
            .roomID
            .blur();
        this.setState({status: 'connect', info: 'Connecting'});
        join(this.state.roomID);
    }
    _switchVideoType() {
        const isFront = !this.state.isFront;
        this.setState({isFront});
        getLocalStream(isFront, function (stream) {
            if (localStream) {
                for (const id in pcPeers) {
                    const pc = pcPeers[id];
                    pc && pc.removeStream(localStream);
                }
                localStream.release();
            }
            localStream = stream;
            container.setState({
                selfViewSrc: stream.toURL()
            });

            for (const id in pcPeers) {
                const pc = pcPeers[id];
                pc && pc.addStream(localStream);
            }
        });
    }
    receiveTextData(data) {
        const textRoomData = this
            .state
            .textRoomData
            .slice();
        textRoomData.push(data);
        this.setState({textRoomData, textRoomValue: ''});
    }
    _textRoomPress() {
        if (!this.state.textRoomValue) {
            return
        }
        const textRoomData = this
            .state
            .textRoomData
            .slice();
        textRoomData.push({user: 'Me', message: this.state.textRoomValue});
        for (const key in pcPeers) {
            const pc = pcPeers[key];
            pc
                .textDataChannel
                .send(this.state.textRoomValue);
        }
        this.setState({textRoomData, textRoomValue: ''});
    }

    render() {
        return (
            <View style={styles.container}>

                {this.state.textRoomConnected}

                <RTCView streamURL={this.state.selfViewSrc} style={styles.selfView} />
                <View style={{alignItems: 'flex-end', flexDirection: 'column' ,marginTop:32, marginRight:15}}>

                    {
                        mapHash(this.state.remoteList, function (remote, index) {
                                return<View key={index} style={{ width:120, height:100,justifyContent:'space-around' , alignItems:'stretch'}}>
                                    <RTCView  streamURL={remote} style={styles.remoteView} />
                                </View>
                            }
                        )}

                </View>
                <View style={{alignItems: 'center'}}>
                    <View
                        style={{
                            backgroundColor:'#00CDE1',
                            alignItems: 'center',
                            width:130,
                            height:30
                        }}>
                        <Button style={{color:'white'}} title='switch' onPress={this._switchVideoType} />
                    </View>
                </View>
            </View>
        );
    }
}


const styles = StyleSheet.create({
    selfView: {
        flexDirection: 'column',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0
    },

    remoteView: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius:10
    },
    container: {
        flex: 1,
        justifyContent: 'space-between',
        flexDirection: 'column',
        alignItems:'stretch'
    }
});
AppRegistry.registerComponent('RCTWebRTCDemo', () => RCTWebRTCDemo);
