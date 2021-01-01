import { Value, Command } from './interfaces'

export class StringValue implements Value<string> {

    public value: string | null = null
    private command : Command

    constructor (data: number[] | string | Date, command: Command ) {
        this.command = command;
        if (data instanceof Array) {
            let payload = data;
                if (payload.length == 0 || payload[0] == 0x00) {
                    this.value = null
                }
                else
                    this.value = (Buffer.from(data).toString('ascii')).split("\0").shift() ?? null
        } else if (typeof(data) == 'string')
        {
            this.value = data
        }
    }

    public toString() {
        return this.value ?? '---'
    }
}