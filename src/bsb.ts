import { BSBDefinition, Command, TranslateItem, Device } from "./interfaces";
import { Observable, Subject } from "rxjs";
import * as net from "net";
import * as stream from "stream";
import e from "express";

import { DateTimeValue } from './DateTimeValue'
import { DayMonthValue } from './DayMonthValue'
import { TimeProgValues } from "./TimeProg";
import { HourMinuteValue } from "./HourMinuteValue";
import { StringValue } from "./StringValue";
import { NumberValue } from "./NumberValue";
import { EnumValue } from "./EnumValue";

import { Definition } from './Definition'
import { Helper } from './Helper'

// /* telegram addresses */
// #define ADDR_HEIZ  0x00
// #define ADDR_EM1   0x03
// #define ADDR_EM2   0x04
// #define ADDR_RGT1  0x06
// #define ADDR_RGT2  0x07
// #define ADDR_CNTR  0x08
// #define ADDR_DISP  0x0A
// #define ADDR_SRVC  0x0B
// #define ADDR_OZW   0x31
// #define ADDR_FE    0x32
// #define ADDR_RC    0x36
// #define ADDR_LAN   0x42
// #define ADDR_ALL   0x7F

export enum MSG_TYPE {
    /** request info telegram */
    QINF = 0x01,
    /** send info telegram */
    INF = 0x02,
    /** set parameter */
    SET = 0x03,
    /** acknowledge set parameter */
    ACK = 0x04,
    /** do not acknowledge set parameter */
    NACK = 0x05,
    /** query parameter */
    QUR = 0x06,
    /** answer query */
    ANS = 0x07,
    /** error */
    ERR = 0x08,
    /** query  reset value */
    QRV = 0x0F,
    /** answer reset value */
    ARV = 0x10,
    /** query reset value failed (1 byte payload of unknown meaning) */
    QRE = 0x11,
    /** internal query type 1 (still undecoded) */
    IQ1 = 0x12,
    /** internal answer type 1 (still undecoded) */
    IA1 = 0x13,
    /** internal query type 2 (still undecoded) */
    IQ2 = 0x14,
    /** internal answer type 2 (still undecoded) */
    IA2 = 0x15,
}

export interface RAWMessage {
    data: number[];
    src: number;
    dst: number;
    typ: MSG_TYPE;
    cmd: number[];
    crc: number[];
    payload: number[];
}

export class BSB {

    constructor(definition: Definition, device: Device, src: number = 0xC2, language: string = "KEY") {

        this.definition = definition;
        this.device = device;
        this.language = language;
        this.src = src;

        this.log$ = new Subject();
        this.Log$ = this.log$.asObservable();
    }

    public Log$: Observable<any>;
    private log$: Subject<any>;

    private definition: Definition
    private client: stream.Duplex = new net.Socket()

    private buffer: number[] = []

    private language: string

    private device: Device

    private src: number

    private openRequests: {
        parameter: number;
        data: number[];
        done: (value: any) => void;
        error: (reason?: any) => void;
    }[] = []

    private calcCRC(data: number[]): [number, number] {
        function crc16(crc16: number, item: number): number {

            crc16 = crc16 ^ (item << 8)

            for (let i = 0; i < 8; i++) {
                if (crc16 & 0x8000) {
                    crc16 = (crc16 << 1) ^ 0x1021
                } else {
                    crc16 <<= 1
                }
            }
            return crc16 & 0xFFFF
        }

        let crc: number = 0

        for (let i = 0; i < data.length; i++) {
            crc = crc16(crc, data[i])
        }

        return [
            (crc >> 8) & 0xFF,
            (crc >> 0) & 0xFF
        ]
    }

    private parseMessage(msg: RAWMessage) {

        if (msg.typ == MSG_TYPE.QUR || msg.typ == MSG_TYPE.SET) {
            let swap = msg.cmd[0];
            msg.cmd[0] = msg.cmd[1];
            msg.cmd[1] = swap;
        }

        let cmd = '0x' + Helper.toHexString(msg.cmd);
        let command = this.definition.findCMD(cmd, this.device);

        let value: string | object | [] | null | number = null

        if (msg.typ == MSG_TYPE.QUR || msg.typ == MSG_TYPE.INF || msg.typ == MSG_TYPE.SET) {
            value = Helper.toHexString(msg.payload);
            if (value.length > 0)
                value = 'Payload: 0x' + value;
        }

        if (msg.typ == MSG_TYPE.ANS || msg.typ == MSG_TYPE.INF) {

            // add Parse of SET Messages also to the Type.from() functions

            if (command) {

                switch (command.type.datatype) {
                    case 'BITS':
                        // TODO
                        break
                    case 'ENUM':
                        value = new EnumValue(msg.payload, command)
                        break
                    case 'VALS':
                        value = new NumberValue(msg.payload, command)
                        break;
                    case 'DDMM':
                        value = new DayMonthValue(msg.payload, command)
                        break
                    case 'DTTM':
                        switch (command.type.name) {
                            case 'DATETIME':
                                value = new DateTimeValue(msg.payload, command)
                                break
                            case 'TIMEPROG':
                                value = new TimeProgValues(msg.payload, command)
                                break
                        }
                        break;
                    case 'HHMM':
                        value = new HourMinuteValue(msg.payload, command)
                        break;
                    case 'STRN':
                        value = new StringValue(msg.payload, command)
                        break;
                    case 'DWHM':
                        // ignore only PPS
                        break;
                    case 'WDAY':
                        // ignore because not used in any command
                        break
                }
            }


            
        }
        if (msg.typ == MSG_TYPE.ANS || msg.typ == MSG_TYPE.ERR) {
            if (this.openRequests.length > 0) {
                let req = this.openRequests.shift();

                req?.done({
                    msg: msg,
                    command: command,
                    value: value,
                    enumvalue: enumvalue,
                    desc: ''
                })
            }
        }
        this.log$.next(MSG_TYPE[msg.typ] + ' '
            + Helper.toHexString([msg.src])
            + ' -> ' + Helper.toHexString([msg.dst])
            + ' ' + cmd + ' ' + Helper.getLanguage(command?.description, this.language) + ' (' + command?.parameter + ') = ' + (value ?? '---').toString());
        //    console.log('********' + this.toHexString(msg.data));
        //    console.log(MSG_TYPE[msg.typ] + ' ' + cmd + ' ' + this.getLanguage(command?.description) + ' (' + command?.parameter + ') = ' + (value ?? '---'));

    }


    private parseBuffer() {
        let pos: number = 0;

        while (pos < this.buffer.length) {
            // BSB
            if ((pos < this.buffer.length - 4) && (this.buffer[pos] == 0xDC)) {
                let len = this.buffer[pos + 3];

                if (pos < this.buffer.length - len + 1) {
                    let newmessage = this.buffer.slice(pos, pos + len);

                    let crc = Helper.toHexString(newmessage.slice(newmessage.length - 2));
                    let crcCalculated = Helper.toHexString(this.calcCRC(newmessage.slice(0, newmessage.length - 2)));

                    if (crc == crcCalculated) {
                        let msg = {
                            data: newmessage,
                            src: newmessage[1] & 0x7F,
                            dst: newmessage[2],
                            typ: newmessage[4],
                            cmd: newmessage.slice(5, 9),
                            crc: newmessage.slice(newmessage.length - 2),
                            payload: newmessage.slice(9, newmessage.length - 2)
                        };
                        this.parseMessage(msg as any);

                        // todo if pos <> 0, send message with
                        // unprocessed data

                        this.buffer = this.buffer.slice(pos + len);

                        pos = -1;
                    }
                    else {
                        // wrong CRC ??
                    }
                }
            }
            pos++;
        }
    }

    public connect(stream: stream.Duplex): void;
    public connect(ip: string, port: number): void;
    public connect(param1: string | stream.Duplex, param2?: number) {
        if (param1 instanceof stream.Duplex) {
            this.client = param1
        }
        else {
            const socket = new net.Socket()

            socket.connect(param2 ?? 0, param1, () => {
                console.log('connected');
            });
            this.client = socket
        }

        this.client.on('data', (data) => {
            for (let i = 0; i < data.length; i++) {
                this.buffer.push(~data[i] & 0xFF)
            }
            this.parseBuffer()
        });
    }

    private getOne(param: number, dst: number = 0x00): Promise<any> {
        const command = this.definition.findParam(param, this.device)

        if (command) {
            let data = Array.prototype.slice.call(Buffer.from(command.command.replace(/0x/g, ''), "hex"), 0)

            const swap = data[0]
            data[0] = data[1]
            data[1] = swap

            const len = 0x0B
            data = [0xDC, this.src, dst, len, MSG_TYPE.QUR, ...data]
            data = [...data, ...this.calcCRC(data)]

            for (let i = 0; i < data.length; i++)
                data[i] = (~data[i]) & 0xFF;

            return new Promise<any>((done, error) => {
                this.openRequests.push({
                    parameter: param,
                    data: data,
                    done: done,
                    error: error
                })
                // todo move the call of the client write to a timer
                this.client.write(Uint8Array.from(data))
            })
        }

        return new Promise((done) => { done(null) })
    }

    public async get(param: number | number[], dst: number = 0x00): Promise<any> {
        if (!Array.isArray(param)) {
            param = [param]
        }

        let result: any = {}
        for (let item of param) {
            const res = await this.getOne(item, dst) as { command: Command, value: any, enumvalue: any, msg: RAWMessage };

            if (res) {
                if (!res.value)
                    res.value = ""

                let desc = ''
                if (res.command.type.datatype == "ENUM") {
                    desc = res.value?.toString()
                    res.value = res.enumvalue
                }
                result[res.command.parameter] = {
                    name: Helper.getLanguage(res.command.description, this.language),
                    error: res.msg.typ == MSG_TYPE.ERR ? res.msg.payload[0] : 0,
                    value: res.msg.typ == MSG_TYPE.ERR ? "" : res.value?.toString(), // add pure value number
                    desc: desc,
                    dataType: res.command.type.datatype_id,
                    readonly: ((res.command.flags?.indexOf('READONLY') ?? -1) != -1) ? 1 : 0,
                    unit: Helper.getLanguage(res.command.type.unit, this.language)
                }
            }
        }
        return result
    }
}